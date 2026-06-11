use std::cell::RefCell;
use std::collections::HashMap;

use cosmic_text::{Attrs, Buffer, FontSystem, Metrics, Shaping};

use crate::font::configure_font_system;

// Bound on cached shaped lines so scrolling feed text cannot grow memory without
// limit; the working set (device chips + visible feed rows) is far smaller.
const MAX_CACHED_LINES: usize = 512;

thread_local! {
    static MEASURER: RefCell<TextMeasurer> = RefCell::new(TextMeasurer::new());
}

/// One whole-line shaping result. `total_width` is the natural single-line
/// width; `cluster_ends` holds, per glyph cluster in logical order, the byte
/// offset just past that cluster and the cumulative width up to it — enough to
/// truncate to a pixel width without ever shaping a single character on its own.
struct ShapedLine {
    total_width: f32,
    cluster_ends: Vec<(usize, f32)>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct LineKey {
    text: String,
    size_bits: u32,
}

struct TextMeasurer {
    font_system: FontSystem,
    cache: HashMap<LineKey, ShapedLine>,
}

impl TextMeasurer {
    fn new() -> Self {
        let mut font_system = FontSystem::new();
        configure_font_system(&mut font_system);
        Self {
            font_system,
            cache: HashMap::new(),
        }
    }

    fn shaped(&mut self, text: &str, font_size: f32) -> &ShapedLine {
        let key = LineKey {
            text: text.to_string(),
            size_bits: font_size.to_bits(),
        };
        if !self.cache.contains_key(&key) {
            let line = self.shape(text, font_size);
            if self.cache.len() >= MAX_CACHED_LINES {
                self.cache.clear();
            }
            self.cache.insert(key.clone(), line);
        }
        self.cache.get(&key).expect("line shaped and cached above")
    }

    fn shape(&mut self, text: &str, font_size: f32) -> ShapedLine {
        let metrics = Metrics::new(font_size, font_size);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        // No width bound → never wrap; we want the natural single-line width.
        // This mirrors the whole-string shaping the renderer already performs,
        // instead of shaping each character in isolation.
        buffer.set_size(None, Some(font_size));
        buffer.set_text(text, &Attrs::new(), Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.font_system, false);

        let mut total_width = 0.0_f32;
        let mut cluster_ends: Vec<(usize, f32)> = Vec::new();
        for run in buffer.layout_runs() {
            total_width = total_width.max(run.line_w);
            let glyphs = run.glyphs;
            for (index, glyph) in glyphs.iter().enumerate() {
                // Cumulative width up to and including this cluster: the next
                // glyph's left edge (a logical advance, so spaces still count
                // even when their hitbox width is zero), or the full line width
                // for the last glyph.
                let cumulative = glyphs
                    .get(index + 1)
                    .map(|next| next.x)
                    .unwrap_or(run.line_w);
                cluster_ends.push((glyph.end, cumulative));
            }
        }
        ShapedLine {
            total_width,
            cluster_ends,
        }
    }
}

/// Natural single-line rendered width of `text` at `font_size`, consistent with
/// the glyphs [`crate::TinySkiaRenderer`] draws. Cached per `(text, size)` so a
/// stable overlay layout re-measures without re-shaping each frame.
pub fn text_width(text: &str, font_size: f32) -> f32 {
    MEASURER.with(|measurer| measurer.borrow_mut().shaped(text, font_size).total_width)
}

/// Byte length of the longest prefix of `text` whose rendered width is within
/// `max_width` at `font_size`. The returned offset is always a glyph-cluster
/// (and therefore `char`) boundary, so slicing `text[..len]` is safe.
pub fn prefix_byte_len_within(text: &str, max_width: f32, font_size: f32) -> usize {
    MEASURER.with(|measurer| {
        let mut measurer = measurer.borrow_mut();
        let line = measurer.shaped(text, font_size);
        let mut keep = 0;
        for &(end_byte, cumulative) in &line.cluster_ends {
            if cumulative <= max_width {
                keep = end_byte;
            } else {
                break;
            }
        }
        keep.min(text.len())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_has_zero_width() {
        assert_eq!(text_width("", 14.0), 0.0);
    }

    #[test]
    fn prefix_len_is_char_boundary() {
        let text = "日本語テスト";
        let keep = prefix_byte_len_within(text, 20.0, 14.0);
        assert!(
            text.is_char_boundary(keep),
            "keep={keep} not a char boundary"
        );
        assert!(keep <= text.len());
    }

    #[test]
    fn wider_width_allows_longer_or_equal_prefix() {
        let text = "abcdefghij";
        let narrow = prefix_byte_len_within(text, 10.0, 14.0);
        let wide = prefix_byte_len_within(text, 1000.0, 14.0);
        assert!(wide >= narrow);
    }

    #[test]
    fn measuring_unusual_unicode_never_panics() {
        for text in [
            "こんにちは世界",
            "🎮👾🕹️",
            "a\u{0301}\u{200d}b",
            "🇯🇵🇺🇸",
            "\u{0301}",
            "",
        ] {
            let _ = text_width(text, 17.0);
            let _ = prefix_byte_len_within(text, 24.0, 17.0);
        }
    }
}
