from typing import Optional

import torch


def reconstruction_mse(pred: torch.Tensor, target: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
    """Average per-patch MSE; if mask is given, only over masked patches."""
    mse = (pred - target) ** 2
    mse = mse.mean(dim=-1)  # (B, N)
    if mask is not None:
        mse = (mse * mask).sum() / mask.sum().clamp(min=1.0)
    else:
        mse = mse.mean()
    return mse
