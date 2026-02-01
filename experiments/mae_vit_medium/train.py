import os
import time
from typing import Dict

import torch
from torch import optim

from dataset import get_dataloader
from losses import mae_loss
from metrics import reconstruction_mse
from model import MAEViT
from utils import (
    ensure_dir,
    load_checkpoint,
    load_config,
    parse_args,
    save_checkpoint,
    seed_everything,
)


def build_model(config: Dict) -> MAEViT:
    mcfg = config['model']
    model = MAEViT(
        img_size=int(mcfg['image_size']),
        patch_size=int(mcfg['patch_size']),
        in_chans=int(mcfg['in_channels']),
        embed_dim=int(mcfg['embed_dim']),
        depth=int(mcfg['depth']),
        num_heads=int(mcfg['num_heads']),
        mlp_ratio=float(mcfg.get('mlp_ratio', 4.0)),
        decoder_embed_dim=int(mcfg['decoder_embed_dim']),
        decoder_depth=int(mcfg['decoder_depth']),
        decoder_num_heads=int(mcfg.get('decoder_num_heads', mcfg['num_heads'])),
        mask_ratio=float(mcfg['mask_ratio']),
    )
    return model


def get_device(config: Dict) -> torch.device:
    cfg_device = str(config['training']['device'])
    if cfg_device.startswith('cuda') and not torch.cuda.is_available():
        print('CUDA not available, falling back to CPU.')
        return torch.device('cpu')
    return torch.device(cfg_device)


def train_one_epoch(model: MAEViT, loader, optimizer, device, config: Dict, epoch: int) -> float:
    model.train()
    running_loss = 0.0
    total_samples = 0
    log_interval = int(config['training'].get('log_interval', 100))
    mask_ratio = float(config['model']['mask_ratio'])

    for step, imgs in enumerate(loader):
        imgs = imgs.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        pred, target, mask = model(imgs, mask_ratio=mask_ratio)
        loss = mae_loss(pred, target, mask)
        loss.backward()
        optimizer.step()

        batch_size = imgs.size(0)
        running_loss += loss.item() * batch_size
        total_samples += batch_size

        if (step + 1) % log_interval == 0:
            avg_loss = running_loss / total_samples
            print(f'Epoch {epoch} Step {step + 1}/{len(loader)} - Train Loss: {avg_loss:.4f}')

    return running_loss / max(total_samples, 1)


@torch.no_grad()
def evaluate(model: MAEViT, loader, device, config: Dict) -> Dict[str, float]:
    model.eval()
    total_loss = 0.0
    total_metric = 0.0
    total_samples = 0
    mask_ratio = float(config['model']['mask_ratio'])

    for imgs in loader:
        imgs = imgs.to(device, non_blocking=True)
        pred, target, mask = model(imgs, mask_ratio=mask_ratio)
        loss = mae_loss(pred, target, mask)
        metric = reconstruction_mse(pred, target, mask)

        batch_size = imgs.size(0)
        total_loss += loss.item() * batch_size
        total_metric += metric.item() * batch_size
        total_samples += batch_size

    avg_loss = total_loss / max(total_samples, 1)
    avg_metric = total_metric / max(total_samples, 1)
    return {'loss': avg_loss, 'reconstruction_mse': avg_metric}


def main() -> None:
    args = parse_args()
    config = load_config(args.config, args.overrides)

    seed = int(config.get('seed', 0))
    seed_everything(seed)

    device = get_device(config)

    model = build_model(config).to(device)

    tr_cfg = config['training']
    optimizer = optim.AdamW(
        model.parameters(),
        lr=float(tr_cfg['lr']),
        weight_decay=float(tr_cfg['weight_decay']),
    )

    train_loader = get_dataloader(config, train=True)
    val_loader = get_dataloader(config, train=False)

    output_dir = config.get('output_dir', 'checkpoints')
    ensure_dir(output_dir)

    start_epoch = 1
    best_val_loss = float('inf')

    resume_path = tr_cfg.get('resume_path')
    if resume_path:
        if os.path.isfile(resume_path):
            print(f'Resuming from checkpoint: {resume_path}')
            ckpt = load_checkpoint(resume_path, model, optimizer, map_location=device)
            start_epoch = int(ckpt.get('epoch', 0)) + 1
            best_val_loss = float(ckpt.get('best_val_loss', best_val_loss))
        else:
            print(f'Warning: resume_path {resume_path} not found, starting from scratch.')

    num_epochs = int(tr_cfg['epochs'])

    for epoch in range(start_epoch, num_epochs + 1):
        t0 = time.time()
        train_loss = train_one_epoch(model, train_loader, optimizer, device, config, epoch)
        val_stats = evaluate(model, val_loader, device, config)
        dt = time.time() - t0

        val_loss = val_stats['loss']
        print(
            f'Epoch {epoch}/{num_epochs} - ' \
            f'Train Loss: {train_loss:.4f} - ' \
            f'Val Loss: {val_loss:.4f} - ' \
            f'Val Recon MSE: {val_stats["reconstruction_mse"]:.4f} - ' \
            f'Time: {dt:.1f}s'
        )

        ckpt = {
            'epoch': epoch,
            'model_state': model.state_dict(),
            'optimizer_state': optimizer.state_dict(),
            'config': config,
            'best_val_loss': best_val_loss,
        }
        last_path = os.path.join(output_dir, 'last.pth')
        save_checkpoint(ckpt, last_path)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_path = os.path.join(output_dir, 'best.pth')
            save_checkpoint(ckpt, best_path)
            print(f'New best model saved to {best_path}')


if __name__ == '__main__':
    main()
