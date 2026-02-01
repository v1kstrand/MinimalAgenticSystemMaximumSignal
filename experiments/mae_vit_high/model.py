import torch
from torch import nn


class TransformerBlock(nn.Module):
    def __init__(self, dim, num_heads, mlp_ratio=4.0, dropout=0.0):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(embed_dim=dim, num_heads=num_heads, batch_first=True)
        self.norm2 = nn.LayerNorm(dim)
        hidden_dim = int(dim * mlp_ratio)
        self.mlp = nn.Sequential(
            nn.Linear(dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, dim),
        )
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        y = self.norm1(x)
        attn_output, _ = self.attn(y, y, y, need_weights=False)
        x = x + self.dropout(attn_output)
        y = self.norm2(x)
        y = self.mlp(y)
        x = x + self.dropout(y)
        return x


class MAEViT(nn.Module):
    def __init__(
        self,
        img_size=64,
        patch_size=8,
        in_chans=3,
        embed_dim=256,
        depth=6,
        num_heads=8,
        mlp_ratio=4.0,
        decoder_embed_dim=128,
        decoder_depth=4,
        decoder_num_heads=4,
        mask_ratio=0.75,
    ):
        super().__init__()

        self.img_size = img_size
        self.patch_size = patch_size
        self.in_chans = in_chans
        self.embed_dim = embed_dim
        self.mask_ratio = mask_ratio

        assert img_size % patch_size == 0, "img_size must be divisible by patch_size"
        self.num_patches = (img_size // patch_size) ** 2

        # Patch embedding
        self.patch_embed = nn.Conv2d(in_chans, embed_dim, kernel_size=patch_size, stride=patch_size)

        # Positional embedding for encoder
        self.pos_embed = nn.Parameter(torch.zeros(1, self.num_patches, embed_dim))

        # Encoder
        self.encoder_blocks = nn.ModuleList(
            [TransformerBlock(embed_dim, num_heads, mlp_ratio) for _ in range(depth)]
        )
        self.encoder_norm = nn.LayerNorm(embed_dim)

        # Decoder
        if decoder_embed_dim != embed_dim:
            self.decoder_embed = nn.Linear(embed_dim, decoder_embed_dim)
        else:
            self.decoder_embed = nn.Identity()

        self.mask_token = nn.Parameter(torch.zeros(1, 1, decoder_embed_dim))
        self.decoder_pos_embed = nn.Parameter(torch.zeros(1, self.num_patches, decoder_embed_dim))

        self.decoder_blocks = nn.ModuleList(
            [TransformerBlock(decoder_embed_dim, decoder_num_heads, mlp_ratio) for _ in range(decoder_depth)]
        )
        self.decoder_norm = nn.LayerNorm(decoder_embed_dim)

        patch_dim = patch_size * patch_size * in_chans
        self.decoder_pred = nn.Linear(decoder_embed_dim, patch_dim)

        self._initialize_weights()

    def _initialize_weights(self):
        nn.init.normal_(self.pos_embed, std=0.02)
        nn.init.normal_(self.decoder_pos_embed, std=0.02)
        nn.init.normal_(self.mask_token, std=0.02)

        def _init(m):
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

        self.apply(_init)

    def random_masking(self, x, mask_ratio):
        """Per-sample random masking.

        x: [B, N, C]
        Returns: x_masked, mask, ids_restore
        """
        B, N, C = x.shape
        len_keep = int(N * (1 - mask_ratio))

        noise = torch.rand(B, N, device=x.device)
        ids_shuffle = torch.argsort(noise, dim=1)
        ids_restore = torch.argsort(ids_shuffle, dim=1)

        ids_keep = ids_shuffle[:, :len_keep]
        x_masked = torch.gather(x, dim=1, index=ids_keep.unsqueeze(-1).repeat(1, 1, C))

        mask = torch.ones(B, N, device=x.device)
        mask[:, :len_keep] = 0
        mask = torch.gather(mask, dim=1, index=ids_restore)

        return x_masked, mask, ids_restore

    def forward_encoder(self, x):
        # x: [B, C, H, W]
        x = self.patch_embed(x)  # [B, embed_dim, H/ps, W/ps]
        x = x.flatten(2).transpose(1, 2)  # [B, N, embed_dim]

        x = x + self.pos_embed
        x, mask, ids_restore = self.random_masking(x, self.mask_ratio)

        for blk in self.encoder_blocks:
            x = blk(x)
        x = self.encoder_norm(x)
        return x, mask, ids_restore

    def forward_decoder(self, x, ids_restore):
        x = self.decoder_embed(x)
        B, N_visible, C = x.shape
        N = ids_restore.shape[1]
        num_mask = N - N_visible

        mask_tokens = self.mask_token.repeat(B, num_mask, 1)
        x_ = torch.cat([x, mask_tokens], dim=1)

        ids_restore_expanded = ids_restore.unsqueeze(-1).repeat(1, 1, C)
        x_ = torch.gather(x_, dim=1, index=ids_restore_expanded)

        x_ = x_ + self.decoder_pos_embed

        for blk in self.decoder_blocks:
            x_ = blk(x_)
        x_ = self.decoder_norm(x_)
        x_ = self.decoder_pred(x_)
        return x_

    def forward(self, imgs):
        latent, mask, ids_restore = self.forward_encoder(imgs)
        pred = self.forward_decoder(latent, ids_restore)
        return pred, mask
