import os
import random
import math

import numpy as np
import torch
import yaml


def set_seed(seed):
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def parse_value(raw):
    lower = raw.lower()
    if lower in ("true", "false"):
        return lower == "true"
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


def apply_overrides(cfg, overrides):
    for ov in overrides or []:
        if "=" not in ov:
            continue
        key_str, value_str = ov.split("=", 1)
        keys = key_str.split(".")
        d = cfg
        for k in keys[:-1]:
            if k not in d or not isinstance(d[k], dict):
                d[k] = {}
            d = d[k]
        d[keys[-1]] = parse_value(value_str)
    return cfg


def load_config(path, overrides=None):
    with open(path, "r") as f:
        cfg = yaml.safe_load(f)
    cfg = apply_overrides(cfg, overrides)
    return cfg


def save_checkpoint(state, path):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    torch.save(state, path)


def load_checkpoint(path, map_location=None):
    return torch.load(path, map_location=map_location)


def patchify(imgs, patch_size):
    """Convert images to patch sequences.

    imgs: [B, C, H, W]
    returns: [B, N, patch_size*patch_size*C]
    """
    B, C, H, W = imgs.shape
    assert H % patch_size == 0 and W % patch_size == 0, "Image dimensions must be divisible by patch_size"
    h = H // patch_size
    w = W // patch_size

    x = imgs.reshape(B, C, h, patch_size, w, patch_size)
    x = x.permute(0, 2, 4, 3, 5, 1)  # [B, h, w, p, p, C]
    x = x.reshape(B, h * w, patch_size * patch_size * C)
    return x


def unpatchify(patches, patch_size, channels):
    """Convert patch sequences back to images.

    patches: [B, N, patch_size*patch_size*C]
    returns: [B, C, H, W]
    """
    B, N, D = patches.shape
    h = w = int(math.sqrt(N))
    assert h * w == N, "Number of patches must be a perfect square"

    x = patches.reshape(B, h, w, patch_size, patch_size, channels)
    x = x.permute(0, 5, 1, 3, 2, 4)  # [B, C, h, p, w, p]
    x = x.reshape(B, channels, h * patch_size, w * patch_size)
    return x
