import random
from typing import Dict

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader


class SyntheticImageDataset(Dataset):
    def __init__(self, size: int, image_size: int, in_channels: int, seed: int = 0) -> None:
        super().__init__()
        self.size = size
        self.image_size = image_size
        self.in_channels = in_channels

        g = torch.Generator()
        g.manual_seed(seed)
        self.data = torch.rand(size, in_channels, image_size, image_size, generator=g)

    def __len__(self) -> int:
        return self.size

    def __getitem__(self, idx: int) -> torch.Tensor:
        return self.data[idx]


def _seed_worker(worker_id: int, base_seed: int) -> None:
    worker_seed = base_seed + worker_id
    np.random.seed(worker_seed)
    random.seed(worker_seed)
    torch.manual_seed(worker_seed)


def get_dataloader(config: Dict, train: bool = True) -> DataLoader:
    ds_cfg = config['dataset']
    name = ds_cfg['name']
    if name != 'synthetic':
        raise ValueError(f'Unsupported dataset name: {name}. Only "synthetic" is implemented.')

    size_key = 'train_size' if train else 'val_size'
    size = int(ds_cfg[size_key])
    image_size = int(ds_cfg['image_size'])
    in_channels = int(ds_cfg['in_channels'])

    seed = int(config.get('seed', 0)) + (0 if train else 1)
    dataset = SyntheticImageDataset(size, image_size, in_channels, seed=seed)

    batch_size = int(config['training']['batch_size'])
    num_workers = int(config['training']['num_workers'])

    generator = torch.Generator()
    generator.manual_seed(seed)

    def worker_init_fn(worker_id: int) -> None:
        _seed_worker(worker_id, seed)

    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=train,
        num_workers=num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
        generator=generator,
    )
    return loader
