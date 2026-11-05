"""User-facing output settings, independent from model-generated content."""
SIZES = {"1080p": (1080, 1920), "1440p": (1440, 2560), "4k": (2160, 3840)}


def video_settings(config):
    settings = config.get("视频", {})
    if not isinstance(settings, dict):
        raise ValueError("视频配置必须包含 清晰度、帧率 字段。")
    quality = str(settings.get("清晰度", "1080p")).strip().lower()
    fps = settings.get("帧率", 30)
    show_captions = config.get("显示字幕", True)
    if type(show_captions) is not bool:
        raise ValueError("显示字幕 必须是 true 或 false。")
    if quality not in SIZES:
        raise ValueError("清晰度仅支持 1080p、1440p、4K。")
    if type(fps) is not int or fps not in (30, 60):
        raise ValueError("帧率仅支持整数 30 或 60。")
    width, height = SIZES[quality]
    return {"resolution": "4K" if quality == "4k" else quality, "width": width, "height": height, "fps": fps,
            "showCaptions": show_captions}
