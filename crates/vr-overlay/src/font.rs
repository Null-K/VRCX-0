use cosmic_text::FontSystem;

const PREFERRED_SANS_FAMILIES: &[&str] = &[
    "Microsoft YaHei UI",
    "Microsoft YaHei",
    "Microsoft JhengHei UI",
    "Microsoft JhengHei",
    "Yu Gothic UI",
    "Noto Sans CJK SC",
    "Noto Sans CJK JP",
    "Noto Sans CJK TC",
    "Source Han Sans SC",
    "Source Han Sans JP",
    "Source Han Sans TC",
    "WenQuanYi Micro Hei",
];

pub(crate) fn preferred_sans_family(font_system: &FontSystem) -> Option<String> {
    PREFERRED_SANS_FAMILIES
        .iter()
        .find(|family| {
            font_system.db().faces().any(|face| {
                face.families
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case(family))
            })
        })
        .map(|family| (*family).to_string())
}

pub(crate) fn configure_font_system(font_system: &mut FontSystem) {
    if let Some(family) = preferred_sans_family(font_system) {
        font_system.db_mut().set_sans_serif_family(family);
    }
}
