import argparse
import os
import random
from typing import Any, Dict, List

import numpy as np
import torch
import yaml


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def save_checkpoint(state: Dict[str, Any], path: str) -> None:
    ensure_dir(os.path.dirname(path) or '.')
    torch.save(state, path)


def load_checkpoint(path: str, model: torch.nn.Module, optimizer: torch.optim.Optimizer = None, map_location: str = 'cpu') -> Dict[str, Any]:
    checkpoint = torch.load(path, map_location=map_location)
    model.load_state_dict(checkpoint['model_state'])
    if optimizer is not None and 'optimizer_state' in checkpoint:
        optimizer.load_state_dict(checkpoint['optimizer_state'])
    return checkpoint


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='MAE ViT self-supervised training')
    parser.add_argument('--config', type=str, default='config.yaml', help='Path to config file')
    parser.add_argument('overrides', nargs='*', help='Configuration overrides in key=value format')
    return parser.parse_args()


def _set_in_dict(d: Dict[str, Any], keys: List[str], value: Any) -> None:
    cur = d
    for k in keys[:-1]:
        if k not in cur or not isinstance(cur[k], dict):
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value


def apply_overrides(config: Dict[str, Any], overrides: List[str]) -> Dict[str, Any]:
    for ov in overrides:
        if '=' not in ov:
            continue
        key, val = ov.split('=', 1)
        key = key.strip()
        val = val.strip()
        if not key:
            continue
        try:
            parsed_val = yaml.safe_load(val)
        except Exception:
            parsed_val = val
        _set_in_dict(config, key.split('.'), parsed_val)
    return config


def load_config(path: str, overrides: List[str]) -> Dict[str, Any]:
    with open(path, 'r') as f:
        cfg = yaml.safe_load(f) or {}
    cfg = apply_overrides(cfg, overrides)
    return cfg
