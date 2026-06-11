use super::measure::{prefix_byte_len_within, text_width};

const ELLIPSIS: char = '…';
const ELLIPSIS_STR: &str = "…";

/// Truncate `text` to fit `max_width` at `font_size`, appending an ellipsis when
/// it does not fit. Widths come from a single cached whole-line shaping pass, so
/// no character is ever shaped in isolation.
pub fn ellipsize_to_width(text: &str, max_width: f32, font_size: f32) -> String {
    let max_width = max_width.max(1.0);
    if text_width(text, font_size) <= max_width {
        return text.to_string();
    }

    let ellipsis_width = text_width(ELLIPSIS_STR, font_size);
    let available = (max_width - ellipsis_width).max(0.0);
    let keep = prefix_byte_len_within(text, available, font_size);
    match text.get(..keep) {
        Some(prefix) if !prefix.is_empty() => {
            let mut output = prefix.to_string();
            output.push(ELLIPSIS);
            output
        }
        _ => ELLIPSIS.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_stays_empty() {
        assert_eq!(ellipsize_to_width("", 100.0, 14.0), "");
    }

    #[test]
    fn fitting_text_is_returned_verbatim() {
        // A very large budget can never truncate.
        assert_eq!(ellipsize_to_width("Hello", 100_000.0, 14.0), "Hello");
    }

    #[test]
    fn truncated_text_ends_with_ellipsis() {
        let out = ellipsize_to_width("Hello, world, this is a long line", 30.0, 14.0);
        assert!(
            out == "…" || out.ends_with('…'),
            "unexpected ellipsize output: {out:?}"
        );
    }

    #[test]
    fn ellipsizing_unusual_unicode_never_panics() {
        for text in [
            "こんにちは世界の皆さん",
            "🎮👾🕹️🎲🎯",
            "a\u{0301}\u{200d}b",
            "🇯🇵🇺🇸",
        ] {
            let _ = ellipsize_to_width(text, 24.0, 17.0);
        }
    }
}
