import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def build_mask(image, min_value=70, min_saturation=35):
    rgb = image.astype(np.int16)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = mx - mn
    mask = ((mx > min_value) & (sat > min_saturation)).astype(np.uint8) * 255
    return mask


def component_color(component_pixels):
    if component_pixels.size == 0:
        return None
    median = np.median(component_pixels, axis=0)
    return {
        "r": int(round(float(median[0]))),
        "g": int(round(float(median[1]))),
        "b": int(round(float(median[2]))),
    }


def detect_blobs(image, min_area=18, min_height=6, max_aspect=4.0):
    mask = build_mask(image)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    blobs = []
    height, width = image.shape[:2]

    for index in range(1, num_labels):
        x, y, w, h, area = stats[index]
        if area < min_area:
            continue
        if h < min_height:
            continue
        if w / max(h, 1) > max_aspect:
            continue
        if x <= 1 and w > width * 0.5:
            continue

        component_mask = labels[y:y + h, x:x + w] == index
        pixels = image[y:y + h, x:x + w][component_mask]
        color = component_color(pixels)
        cx, cy = centroids[index]
        blobs.append({
            "bbox": {
                "x": int(x),
                "y": int(y),
                "width": int(w),
                "height": int(h),
            },
            "center": {
                "x": float(cx),
                "y": float(cy),
            },
            "area": int(area),
            "aspect_ratio": round(float(w / max(h, 1)), 4),
            "rgb": color,
        })

    return {
        "success": True,
        "image_width": int(width),
        "image_height": int(height),
        "blob_count": len(blobs),
        "blobs": blobs,
    }


def main():
    parser = argparse.ArgumentParser(description="Detect colored DeMARK-like label blobs in a screenshot column.")
    parser.add_argument("image_path")
    parser.add_argument("--min-area", type=int, default=18)
    parser.add_argument("--min-height", type=int, default=6)
    parser.add_argument("--max-aspect", type=float, default=4.0)
    args = parser.parse_args()

    image_path = Path(args.image_path).resolve()
    image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise SystemExit(json.dumps({
            "success": False,
            "error": f"Could not read image: {image_path}",
        }))

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    result = detect_blobs(
        image_rgb,
        min_area=args.min_area,
        min_height=args.min_height,
        max_aspect=args.max_aspect,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
