# MAE ViT Self-Supervised Training (PyTorch)

Minimal, runnable implementation of a Masked Autoencoder (MAE) with a Vision Transformer (ViT) backbone, trained in a self-supervised way on a synthetic dataset.

## Features

- Pure PyTorch (no Lightning, no distributed training, no mixed precision)
- MAE-style ViT encoder/decoder with patchify, random masking, and reconstruction
- Simple synthetic image dataset (no external downloads required)
- Config-driven hyperparameters via `config.yaml`
- Command-line config overrides (e.g. `training.epochs=5`)
- Deterministic seeding utilities
- Training and evaluation loops
- Checkpoint save/load (last and best)

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

The default configuration is in `config.yaml`. Key sections:

- `model`: ViT / MAE architecture (image size, patch size, dims, depths, mask ratio)
- `training`: epochs, batch size, learning rate, device, etc.
- `dataset`: synthetic dataset settings (image size, train/val sizes)
- `seed`: global random seed
- `output_dir`: where checkpoints are written

Example snippet from `config.yaml`:

```yaml
model:
  image_size: 32
  patch_size: 4
  in_channels: 3
  embed_dim: 256
  depth: 4
  num_heads: 4
  mlp_ratio: 4.0
  decoder_embed_dim: 128
  decoder_depth: 2
  decoder_num_heads: 4
  mask_ratio: 0.75
```

## Running Training

Basic run using the default config:

```bash
python train.py
```

Choose CPU explicitly:

```bash
python train.py training.device=cpu
```

Change the number of epochs and batch size from the command line:

```bash
python train.py training.epochs=5 training.batch_size=128
```

All overrides use `key=value` format, where `key` can be nested with dots, e.g. `model.mask_ratio=0.9`.

## Checkpoints

Checkpoints are saved in `output_dir` (default: `checkpoints/`):

- `last.pth`: latest epoch
- `best.pth`: best validation loss so far

To resume from a checkpoint, set in `config.yaml` or via CLI:

```bash
python train.py training.resume_path=checkpoints/last.pth
```

## Files

- `config.yaml` – Configuration for model, training, dataset, and output
- `model.py` – MAE ViT encoder/decoder implementation
- `dataset.py` – Synthetic image dataset and dataloader factory
- `train.py` – Training and evaluation loops, checkpointing, config handling
- `losses.py` – MAE reconstruction loss on masked patches
- `metrics.py` – Simple reconstruction metrics
- `utils.py` – Seeding, checkpoint utilities, and config/CLI parsing
- `requirements.txt` – Minimal Python dependencies

## Notes

- The provided synthetic dataset is purely random noise; this is intended to make the repo fully self-contained and runnable without downloads.
- To adapt to a real dataset, extend `dataset.py` with your own dataset loader and point `dataset.name` to it.
