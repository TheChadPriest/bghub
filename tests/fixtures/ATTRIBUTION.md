# Test fixture sources

All photographic fixtures are derived from CC0 (public-domain dedication) images on Wikimedia Commons:

| Fixture | Source | License |
|---|---|---|
| bag.* , bag*.heic | [1935-45 Prada handbag, tooled and gilded leather 01.jpg](https://commons.wikimedia.org/wiki/File:1935-45_Prada_handbag,_tooled_and_gilded_leather_01.jpg) | CC0 |
| jacket.jpg | [Jean jacket.jpg](https://commons.wikimedia.org/wiki/File:Jean_jacket.jpg) | CC0 |
| sneakers-large.jpg | [Sneakers and sweatpants on purple background.jpg](https://commons.wikimedia.org/wiki/File:Sneakers_and_sweatpants_on_purple_background.jpg) | CC0 |

HEIC files were encoded locally with pillow-heif (`scripts/make-heic-fixtures.py`); other fixtures by `scripts/make-fixtures.py`.
Synthetic, corrupt, SVG and oversized-header fixtures are generated and contain no third-party content.
