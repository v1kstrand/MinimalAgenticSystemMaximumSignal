import torch


def patch_mse(pred, target):
    """Mean squared error over all patches and patch elements."""
    return torch.mean((pred - target) ** 2).item()


def patch_mae(pred, target):
    """Mean absolute error over all patches and patch elements."""
    return torch.mean(torch.abs(pred - target)).item()
