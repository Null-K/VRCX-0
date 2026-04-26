export function getMyAvatarsGridMetrics({ cardScale, cardSpacing, width }) {
    const gridGap = Math.round(12 * cardSpacing);
    const gridMinWidth = Math.round(Math.max(200, 320 * cardScale));
    const gridColumnCount = Math.max(
        1,
        Math.floor((width + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const gridColumnWidth =
        width > 0
            ? Math.max(
                  gridMinWidth,
                  (width - gridGap * Math.max(0, gridColumnCount - 1)) /
                      gridColumnCount
              )
            : gridMinWidth;
    const cardNameFontSize = Math.max(12, Math.round(22 * cardScale));
    const cardNameHeight = cardNameFontSize * 2.75;
    const cardBodyPaddingY = Math.round(6 * cardScale) * 2;
    const cardTagsHeight = Math.max(14, Math.round(22 * cardScale));
    const cardBodyGap = 2;
    const cardBodyHeight =
        cardBodyPaddingY + cardNameHeight + cardBodyGap + cardTagsHeight;
    const rowPaddingY = 4;
    const gridRowHeight = Math.ceil(
        gridColumnWidth * 0.4 + cardBodyHeight + rowPaddingY + gridGap
    );

    return {
        gridGap,
        gridMinWidth,
        gridColumnCount,
        gridColumnWidth,
        gridRowHeight
    };
}

export function buildMyAvatarsGridRows({
    avatars,
    gridColumnCount,
    gridRowHeight
}) {
    const rows = [];
    const visibleAvatars = Array.isArray(avatars) ? avatars : [];
    for (
        let index = 0;
        index < visibleAvatars.length;
        index += gridColumnCount
    ) {
        rows.push({
            key: `grid-row:${index}`,
            avatars: visibleAvatars.slice(index, index + gridColumnCount),
            top: rows.length * gridRowHeight,
            height: gridRowHeight
        });
    }
    return rows;
}

export function getVisibleMyAvatarsGridRows({
    gridRows,
    scrollTop,
    viewportHeight
}) {
    const overscan = Math.max(480, viewportHeight);
    const start = Math.max(0, scrollTop - overscan);
    const end = scrollTop + viewportHeight + overscan;
    const visibleGridRows = Array.isArray(gridRows) ? gridRows : [];
    return visibleGridRows.filter(
        (row) => row.top + row.height >= start && row.top <= end
    );
}
