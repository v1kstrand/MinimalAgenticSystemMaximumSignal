import math
from typing import Tuple

import torch
from torch import nn


class PatchEmbed(nn.Module):
    def __init__(self, img_size: int, patch_size: int, in_chans: int, embed_dim: int) -> None:
        super().__init__()
        assert img_size % patch_size == 0, 'Image size must be divisible by patch size.'
        self.img_size = img_size
        self.patch_size = patch_size
        self.num_patches = (img_size // patch_size) ** 2

        self.proj = nn.Conv2d(in_chans, embed_dim, kernel_size=patch_size, stride=patch_size)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, C, H, W)
        x = self.proj(x)  # (B, D, H/P, W/P)
        x = x.flatten(2).transpose(1, 2)  # (B, N, D)
        return x


class TransformerBlock(nn.Module):
    def __init__(self, dim: int, num_heads: int, mlp_ratio: float = 4.0, drop: float = 0.0) -> None:
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, num_heads, batch_first=True)
        self.norm2 = nn.LayerNorm(dim)

        hidden_dim = int(dim * mlp_ratio)
        self.mlp = nn.Sequential(
            nn.Linear(dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, dim),
        )
        self.drop = nn.Dropout(drop) if drop > 0 else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Self-attention
        x_attn = self.attn(self.norm1(x), self.norm1(x), self.norm1(x))[0]
        x = x + self.drop(x_attn)
        # MLP
        x_mlp = self.mlp(self.norm2(x))
        x = x + self.drop(x_mlp)
        return x


class MAEViT(nn.Module):
    def __init__(
        self,
        img_size: int = 32,
        patch_size: int = 4,
        in_chans: int = 3,
        embed_dim: int = 256,
        depth: int = 4,
        num_heads: int = 4,
        mlp_ratio: float = 4.0,
        decoder_embed_dim: int = 128,
        decoder_depth: int = 2,
        decoder_num_heads: int = 4,
        mask_ratio: float = 0.75,
    ) -> None:
        super().__init__()
        self.img_size = img_size
        self.patch_size = patch_size
        self.in_chans = in_chans
        self.embed_dim = embed_dim
        self.mask_ratio = mask_ratio

        # Encoder
        self.patch_embed = PatchEmbed(img_size, patch_size, in_chans, embed_dim)
        num_patches = self.patch_embed.num_patches

        self.pos_embed = nn.Parameter(torch.zeros(1, num_patches, embed_dim))
        self.encoder_blocks = nn.ModuleList([
            TransformerBlock(embed_dim, num_heads, mlp_ratio) for _ in range(depth)
        ])
        self.encoder_norm = nn.LayerNorm(embed_dim)

        # Decoder
        self.decoder_embed = nn.Linear(embed_dim, decoder_embed_dim)
        self.mask_token = nn.Parameter(torch.zeros(1, 1, decoder_embed_dim))
        self.decoder_pos_embed = nn.Parameter(torch.zeros(1, num_patches, decoder_embed_dim))
        self.decoder_blocks = nn.ModuleList([
            TransformerBlock(decoder_embed_dim, decoder_num_heads, mlp_ratio) for _ in range(decoder_depth)
        ])
        self.decoder_norm = nn.LayerNorm(decoder_embed_dim)
        self.decoder_pred = nn.Linear(decoder_embed_dim, patch_size * patch_size * in_chans)

        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.LayerNorm):
                nn.init.zeros_(m.bias)
                nn.init.ones_(m.weight)
        nn.init.trunc_normal_(self.pos_embed, std=0.02)
        nn.init.trunc_normal_(self.decoder_pos_embed, std=0.02)
        nn.init.trunc_normal_(self.mask_token, std=0.02)

    def patchify(self, imgs: torch.Tensor) -> torch.Tensor:
        # imgs: (B, C, H, W)
        p = self.patch_size
        B, C, H, W = imgs.shape
        assert H == self.img_size and W == self.img_size
        x = imgs.reshape(B, C, H // p, p, W // p, p)
        x = x.permute(0, 2, 4, 3, 5, 1)  # (B, H/P, W/P, p, p, C)
        x = x.reshape(B, -1, p * p * C)   # (B, N, P^2*C)
        return x

    def unpatchify(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, N, P^2*C)
        p = self.patch_size
        B, N, D = x.shape
        C = self.in_chans
        h = w = int(math.sqrt(N))
        assert h * w == N
        x = x.reshape(B, h, w, p, p, C)
        x = x.permute(0, 5, 1, 3, 2, 4)  # (B, C, H, W)
        imgs = x.reshape(B, C, h * p, w * p)
        return imgs

    def random_masking(self, x: torch.Tensor, mask_ratio: float) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        # x: (B, N, D)
        B, N, D = x.shape
        len_keep = int(N * (1 - mask_ratio))

        noise = torch.rand(B, N, device=x.device)
        ids_shuffle = torch.argsort(noise, dim=1)
        ids_restore = torch.argsort(ids_shuffle, dim=1)

        ids_keep = ids_shuffle[:, :len_keep]
        x_masked = torch.gather(x, 1, ids_keep.unsqueeze(-1).repeat(1, 1, D))

        mask = torch.ones(B, N, device=x.device)
        mask[:, :len_keep] = 0
        mask = torch.gather(mask, 1, ids_restore)

        return x_masked, mask, ids_restore

    def forward(self, imgs: torch.Tensor, mask_ratio: float = None) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        if mask_ratio is None:
            mask_ratio = self.mask_ratio

        # Patch embedding
        x = self.patch_embed(imgs)
        x = x + self.pos_embed

        # Masking
        x_masked, mask, ids_restore = self.random_masking(x, mask_ratio)

        # Encoder
        for blk in self.encoder_blocks:
            x_masked = blk(x_masked)
        x_masked = self.encoder_norm(x_masked)

        # Decoder
        x_dec = self.decoder_embed(x_masked)
        B, N_vis, D_dec = x_dec.shape
        num_patches = self.patch_embed.num_patches
        num_mask = num_patches - N_vis

        mask_tokens = self.mask_token.repeat(B, num_mask, 1)
        x_ = torch.cat([x_dec, mask_tokens], dim=1)
        x_ = torch.gather(
            x_,
            1,
            ids_restore.unsqueeze(-1).repeat(1, 1, D_dec),
        )
        x_ = x_ + self.decoder_pos_embed

        for blk in self.decoder_blocks:
            x_ = blk(x_)
        x_ = self.decoder_norm(x_)

        pred = self.decoder_pred(x_)  # (B, N, P^2*C)
        target = self.patchify(imgs)
        return pred, target, mask
