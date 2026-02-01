import argparse
import os

import torch
from torch import optim

from model import MAEViT
from dataset import build_dataloaders
from losses import mae_loss
import utils
import metrics


def train_one_epoch(model, data_loader, optimizer, device, cfg, epoch):
    model.train()
    running_loss = 0.0
    num_samples = 0
    print_freq = cfg["training"].get("print_freq", 10)
    patch_size = cfg["model"]["patch_size"]

    for step, batch in enumerate(data_loader):
        if isinstance(batch, (list, tuple)):
            imgs = batch[0]
        else:
            imgs = batch

        imgs = imgs.to(device, non_blocking=True)

        optimizer.zero_grad()
        pred, mask = model(imgs)
        target = utils.patchify(imgs, patch_size)
        loss = mae_loss(pred, target, mask)
        loss.backward()
        optimizer.step()

        batch_size = imgs.size(0)
        running_loss += loss.item() * batch_size
        num_samples += batch_size

        if (step + 1) % print_freq == 0:
            avg_loss = running_loss / max(num_samples, 1)
            print(
                f"Epoch [{epoch + 1}] Step [{step + 1}/{len(data_loader)}] "
                f"Train Loss: {avg_loss:.4f}"
            )

    epoch_loss = running_loss / max(num_samples, 1)
    return epoch_loss


def evaluate(model, data_loader, device, cfg):
    if data_loader is None:
        return None, None

    model.eval()
    patch_size = cfg["model"]["patch_size"]
    val_loss = 0.0
    mse_total = 0.0
    num_samples = 0

    with torch.no_grad():
        for batch in data_loader:
            if isinstance(batch, (list, tuple)):
                imgs = batch[0]
            else:
                imgs = batch

            imgs = imgs.to(device, non_blocking=True)

            pred, mask = model(imgs)
            target = utils.patchify(imgs, patch_size)
            loss = mae_loss(pred, target, mask)

            batch_size = imgs.size(0)
            val_loss += loss.item() * batch_size
            mse_total += metrics.patch_mse(pred, target) * batch_size
            num_samples += batch_size

    avg_loss = val_loss / max(num_samples, 1)
    avg_mse = mse_total / max(num_samples, 1)
    return avg_loss, avg_mse


def main():
    parser = argparse.ArgumentParser(description="MAE ViT Self-Supervised Training")
    parser.add_argument("--config", type=str, default="config.yaml", help="Path to config file")
    parser.add_argument(
        "overrides",
        nargs="*",
        help="Configuration overrides in key=value format",
        default=None,
    )
    args = parser.parse_args()

    cfg = utils.load_config(args.config, args.overrides)
    seed = cfg.get("seed", 42)
    utils.set_seed(seed)

    requested_device = cfg.get("device", "auto")
    if requested_device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    elif requested_device == "cuda" and not torch.cuda.is_available():
        print("CUDA requested but not available. Falling back to CPU.")
        device = torch.device("cpu")
    else:
        device = torch.device(requested_device)

    print(f"Using device: {device}")

    train_loader, val_loader = build_dataloaders(cfg)

    model = MAEViT(**cfg["model"]).to(device)

    optimizer = optim.Adam(
        model.parameters(),
        lr=cfg["training"].get("lr", 1e-3),
        weight_decay=cfg["training"].get("weight_decay", 0.0),
    )

    start_epoch = 0
    num_epochs = cfg["training"].get("epochs", 10)
    checkpoint_path = cfg["training"].get("checkpoint_path", "checkpoints/mae_vit.pth")
    resume = cfg["training"].get("resume", False)

    if resume and os.path.isfile(checkpoint_path):
        print(f"Loading checkpoint from {checkpoint_path}")
        checkpoint = utils.load_checkpoint(checkpoint_path, map_location=device)
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        start_epoch = checkpoint.get("epoch", 0) + 1
        print(f"Resumed from epoch {start_epoch}")
    elif resume:
        print(f"Checkpoint {checkpoint_path} not found. Starting from scratch.")

    eval_interval = cfg["training"].get("eval_interval", 1)

    for epoch in range(start_epoch, num_epochs):
        train_loss = train_one_epoch(model, train_loader, optimizer, device, cfg, epoch)

        val_loss = None
        val_mse = None
        if val_loader is not None and ((epoch + 1) % eval_interval == 0):
            val_loss, val_mse = evaluate(model, val_loader, device, cfg)

        if val_loss is not None:
            print(
                f"Epoch [{epoch + 1}/{num_epochs}] "
                f"Train Loss: {train_loss:.4f} "
                f"Val Loss (masked): {val_loss:.4f} "
                f"Val MSE (unmasked): {val_mse:.4f}"
            )
        else:
            print(f"Epoch [{epoch + 1}/{num_epochs}] Train Loss: {train_loss:.4f}")

        state = {
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "epoch": epoch,
            "config": cfg,
        }
        utils.save_checkpoint(state, checkpoint_path)

    print("Training finished.")


if __name__ == "__main__":
    main()
