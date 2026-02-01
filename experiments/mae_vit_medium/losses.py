from typing import Tuple

import torch


def mae_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Mean-squared error on masked patches only.

    pred, target: (B, N, D)
    mask: (B, N) where 1 indicates masked patches
    """
    B, N, D = pred.shape
    mask = mask.unsqueeze(-1)  # (B, N, 1)

    mse = (pred - target) ** 2
    mse = mse.mean(dim=-1, keepdim=True)  # (B, N, 1)

    masked_mse = (mse * mask).sum() / mask.sum().clamp(min=1.0)
    return masked_mse
