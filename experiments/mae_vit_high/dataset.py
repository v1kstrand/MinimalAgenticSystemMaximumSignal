import torch
from torch.utils.data import Dataset, DataLoader, random_split
from torchvision import datasets, transforms


class SyntheticImagesDataset(Dataset):
    def __init__(self, length=10000, image_size=64, in_chans=3, seed=0):
        self.length = length
        self.image_size = image_size
        self.in_chans = in_chans
        self.seed = seed

    def __len__(self):
        return self.length

    def __getitem__(self, idx):
        generator = torch.Generator()
        generator.manual_seed(self.seed + idx)
        img = torch.rand(self.in_chans, self.image_size, self.image_size, generator=generator)
        return img


def build_dataloaders(cfg):
    ds_cfg = cfg["dataset"]
    tr_cfg = cfg["training"]
    name = ds_cfg.get("name", "synthetic").lower()
    seed = cfg.get("seed", 42)

    if name == "synthetic":
        train_dataset = SyntheticImagesDataset(
            length=ds_cfg.get("train_size", 10000),
            image_size=ds_cfg.get("image_size", 64),
            in_chans=ds_cfg.get("in_chans", 3),
            seed=seed,
        )
        val_size = ds_cfg.get("val_size", 1000)
        if val_size and val_size > 0:
            val_dataset = SyntheticImagesDataset(
                length=val_size,
                image_size=ds_cfg.get("image_size", 64),
                in_chans=ds_cfg.get("in_chans", 3),
                seed=seed + 100000,
            )
        else:
            val_dataset = None

    elif name == "imagefolder":
        root = ds_cfg.get("image_folder_path", "")
        if not root:
            raise ValueError("dataset.image_folder_path must be set for imagefolder dataset.")

        img_size = ds_cfg.get("image_size", 64)
        transform = transforms.Compose(
            [
                transforms.Resize(img_size),
                transforms.CenterCrop(img_size),
                transforms.ToTensor(),
            ]
        )

        full_dataset = datasets.ImageFolder(root=root, transform=transform)
        if len(full_dataset) == 0:
            raise ValueError(f"No images found in {root}")

        val_size = max(1, int(0.1 * len(full_dataset)))
        train_size = len(full_dataset) - val_size
        generator = torch.Generator()
        generator.manual_seed(seed)
        train_dataset, val_dataset = random_split(full_dataset, [train_size, val_size], generator=generator)

    else:
        raise ValueError(f"Unknown dataset name: {ds_cfg['name']}")

    train_loader = DataLoader(
        train_dataset,
        batch_size=tr_cfg.get("batch_size", 64),
        shuffle=True,
        num_workers=tr_cfg.get("num_workers", 2),
        pin_memory=True,
    )

    if val_dataset is not None and len(val_dataset) > 0:
        val_loader = DataLoader(
            val_dataset,
            batch_size=tr_cfg.get("batch_size", 64),
            shuffle=False,
            num_workers=tr_cfg.get("num_workers", 2),
            pin_memory=True,
        )
    else:
        val_loader = None

    return train_loader, val_loader
