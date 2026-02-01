# MAE ViT Self-Supervised Training

This repository implements a minimal Masked Autoencoder (MAE) with a Vision Transformer (ViT) backbone using pure PyTorch.

Features:
- MAE ViT encoder/decoder with patchify + random masking
- Self-supervised reconstruction objective (masked patch MSE)
- Synthetic dataset option (no external downloads)
- Simple train + eval loops
- Config-driven hyperparameters via `config.yaml` with CLI overrides
- Checkpoint save/load
- Seeded and deterministic behavior (as far as PyTorch allows)

## Installation

Create a virtual environment (optional) and install dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

All main options live in `config.yaml`:

- `model.*`: ViT/MAE architecture (image size, patch size, dimensions, depths, heads, mask ratio)
- `training.*`: batch size, epochs, learning rate, workers, checkpoint path, etc.
- `dataset.*`:
  - `name`: `"synthetic"` (default) or `"imagefolder"`
  - `image_size`, `in_chans`: image shape
  - `train_size`, `val_size`: sizes for synthetic dataset
  - `image_folder_path`: root directory for `ImageFolder` when using real images

Defaults are set up to run on a small synthetic dataset for quick sanity checks.

## Running Training

With defaults from `config.yaml`:

```bash
python train.py --config config.yaml
```

Training logs per-epoch metrics to stdout and saves checkpoints to the path defined in `training.checkpoint_path`.

### CLI Overrides

You can override any config value from the command line using `key=value` pairs (dot notation for nested keys):

```bash
python train.py --config config.yaml \
    training.epochs=20 \
    training.batch_size=128 \
    model.mask_ratio=0.9
```

Example using a real image folder:

```bash
python train.py --config config.yaml \
    dataset.name=imagefolder \
    dataset.image_folder_path=/path/to/images \
    dataset.image_size=128
```

## Checkpointing

- The latest checkpoint is saved after every epoch to `training.checkpoint_path`.
- To resume from that checkpoint, set `training.resume: true` in `config.yaml` or override it:

```bash
python train.py --config config.yaml training.resume=true
```

If the checkpoint file does not exist, training will start from scratch.

## Reproducibility

`utils.set_seed` is called at startup with `seed` from `config.yaml` to initialize:
- Python `random`
- NumPy
- PyTorch CPU and CUDA RNGs
- cuDNN determinism settings

Note: Some operations in PyTorch may still introduce nondeterminism depending on your hardware and version.

## Files Overview

- `config.yaml` – default configuration
- `model.py` – MAE ViT encoder/decoder
- `dataset.py` – synthetic dataset and DataLoader builder (optionally `ImageFolder`)
- `train.py` – main training & evaluation loop
- `losses.py` – masked reconstruction loss
- `metrics.py` – simple reconstruction metrics
- `utils.py` – config loading, seeding, checkpointing, patchify helpers
- `requirements.txt` – Python dependencies
