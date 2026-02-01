import torch


def mae_loss(pred, target, mask):
    """Mean squared error over masked patches.

    pred: [B, N, P]
    target: [B, N, P]
    mask: [B, N], 1 for masked, 0 for visible
    """
    # Per-patch MSE
    loss = (pred - target) ** 2
    loss = loss.mean(dim=-1)

    if mask.sum() == 0:
        return loss.mean()

    loss = (loss * mask).sum() / mask.sum()
    return loss
