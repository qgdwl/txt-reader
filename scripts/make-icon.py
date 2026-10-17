"""把 image/icon-source.png 转成 Windows 图标（圆角透明）。

运行：python scripts/make-icon.py
产物：assets/icon.ico（多尺寸）、assets/icon.png（512，开发态窗口用）
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "image" / "icon-source.png"
OUT_DIR = ROOT / "assets"
SIZES = [16, 24, 32, 48, 64, 128, 256]
CORNER_RATIO = 0.18  # 圆角半径占边长的比例


def rounded_icon(source: Image.Image, size: int) -> Image.Image:
    image = source.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = max(2, int(size * CORNER_RATIO))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"找不到源图：{SOURCE}")
    OUT_DIR.mkdir(exist_ok=True)

    source = Image.open(SOURCE)
    print(f"源图 {SOURCE.name} {source.size} {source.mode}")

    # 多尺寸 ICO：从最大的开始，Pillow 会写入所有尺寸
    frames = [rounded_icon(source, size) for size in SIZES]
    ico_path = OUT_DIR / "icon.ico"
    frames[-1].save(ico_path, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"写出 {ico_path.relative_to(ROOT)}")

    png_path = OUT_DIR / "icon.png"
    rounded_icon(source, 512).save(png_path, format="PNG")
    print(f"写出 {png_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
