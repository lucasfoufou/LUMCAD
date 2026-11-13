import React from 'react';

// Stroke icons drawn on a 20 × 20 grid with 1.5 px strokes (see .ui-icon).
// Keep new icons in the same grid and stroke style.
const ICONS = {
    // Navigation and selection
    select: <path d="M5 3l10.5 6.2-4.6 1.2 2.4 5-1.9.9-2.4-5L5 14.6z" />,
    pan: <path d="M7 10.5V5.6a1.2 1.2 0 0 1 2.4 0V9.5M9.4 9.5V4.4a1.2 1.2 0 0 1 2.4 0v5.1M11.8 9.6V5.6a1.2 1.2 0 0 1 2.4 0v6c0 3.1-2.1 5.6-5 5.6-2 0-3.2-.9-4.3-2.6l-1.3-2.2a1.2 1.2 0 0 1 2-1.3L7 12.4" />,
    zoomIn: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.5 12.5l4.5 4.5M8.5 6v5M6 8.5h5" /></>,
    zoomOut: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.5 12.5l4.5 4.5M6 8.5h5" /></>,
    fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 7h6v6H7z" />,
    // Draw
    point: <><path d="M10 4v12M4 10h12" /><circle cx="10" cy="10" r="2" /></>,
    line: <><path d="M5.5 14.5l9-9" /><rect x="3" y="14" width="3" height="3" /><rect x="14" y="3" width="3" height="3" /></>,
    xline: <><path d="M2 15L18 5" /><circle cx="8.4" cy="11" r="1.2" /><circle cx="12" cy="8.7" r="1.2" /></>,
    ray: <><path d="M4 14L18 5" /><circle cx="4" cy="14" r="1.6" /></>,
    polyline: <path d="M3 15l4.5-7.5 4 5.5L17 4" />,
    rectangle: <rect x="3" y="5" width="14" height="10" rx="0.5" />,
    polygon: <path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z" />,
    circle: <><circle cx="10" cy="10" r="6.5" /><path d="M10 10h6.5" /><circle cx="10" cy="10" r="0.6" fill="currentColor" /></>,
    arc: <><path d="M3.5 14.5a7 7 0 0 1 13 0" /><circle cx="3.5" cy="14.5" r="1" /><circle cx="16.5" cy="14.5" r="1" /></>,
    ellipse: <ellipse cx="10" cy="10" rx="7" ry="4.3" />,
    spline: <path d="M3 14c2.5-9 5.5 3 8-3.5S15.5 4 17 6" />,
    hatch: <><rect x="3.5" y="3.5" width="13" height="13" /><path d="M3.5 9.5l6-6M3.5 15.5l12-12M9.5 16.5l7-7" /></>,
    text: <path d="M4.5 5h11M10 5v11M7.5 16h5" />,
    mtext: <path d="M3 4.5h8M7 4.5v7M5 11.5h4M12.5 9h4.5M12.5 12h4.5M3 15h14" />,
    // Annotate
    dimension: <path d="M3 6v9M17 6v9M3 10.5h14M3 10.5l2.5-1.8M3 10.5l2.5 1.8M17 10.5l-2.5-1.8M17 10.5l-2.5 1.8" />,
    dimLinear: <><path d="M4 16V6M16 16V6M4 8h12M4 8l2.2-1.5M4 8l2.2 1.5M16 8l-2.2-1.5M16 8l-2.2 1.5" /><path d="M4 16l12-6" strokeDasharray="1.5 2" /></>,
    dimAligned: <path d="M3.5 13l9-9M7.5 17l9-9M5 15l9-9M5 15l.6-2.6M5 15l2.6-.6M14 6l-2.6.6M14 6l-.6 2.6" />,
    dimRadius: <><circle cx="10" cy="10" r="7" /><path d="M10 10l5-5M15 5l-2.8.4M15 5l-.4 2.8" /><circle cx="10" cy="10" r="0.6" fill="currentColor" /></>,
    dimDiameter: <><circle cx="10" cy="10" r="7" /><path d="M5 15L15 5M15 5l-2.8.4M15 5l-.4 2.8M5 15l2.8-.4M5 15l.4-2.8" /></>,
    dimAngular: <path d="M3 17L17 17M3 17L13 5M13.5 17a10.5 10.5 0 0 0-3.4-7.7M13.5 17l-.9-2.2M10.1 9.3l.6 2.3" />,
    dimContinue: <path d="M2.5 6v9M10 6v9M17.5 6v9M2.5 10.5h15M2.5 10.5l2-1.4M2.5 10.5l2 1.4M10 10.5l-2-1.4M10 10.5l-2 1.4M10 10.5l2-1.4M10 10.5l2 1.4M17.5 10.5l-2-1.4M17.5 10.5l-2 1.4" />,
    leader: <path d="M3.5 16.5l7-7h6.5M3.5 16.5l.8-3.2M3.5 16.5l3.2-.8" />,
    table: <><rect x="3" y="4" width="14" height="12" /><path d="M3 8h14M3 12h14M8.5 4v12" /></>,
    image: <><rect x="3" y="4" width="14" height="12" /><path d="M3 13l4-4 3 3 2-2 5 5" /><circle cx="13" cy="7.5" r="1.2" /></>,
    insertBlock: <><rect x="8" y="3" width="9" height="9" /><path d="M10.5 5.5l4 4M14.5 5.5l-4 4" /><path d="M3 17l6-6M9 11H5.5M9 11v3.5" /></>,
    // Inquiry
    measure: <><path d="M2.5 13.5l8-8 4 4-8 8z" /><path d="M5 11l1.5 1.5M7 9l1 1M9 7l1.5 1.5" /></>,
    measureArea: <><path d="M4 15.5V7l5-3.5 7 3V15.5z" /><path d="M7 12.5h6M7 9.5h6" strokeDasharray="1.5 1.5" /></>,
    // Modify
    move: <path d="M10 2.5v15M2.5 10h15M10 2.5l-2.2 2.2M10 2.5l2.2 2.2M10 17.5l-2.2-2.2M10 17.5l2.2-2.2M2.5 10l2.2-2.2M2.5 10l2.2 2.2M17.5 10l-2.2-2.2M17.5 10l-2.2 2.2" />,
    copy: <><rect x="3" y="7" width="9" height="9" /><path d="M8 7V4h9v9h-5" /></>,
    rotate: <><path d="M15.6 7.2A6.5 6.5 0 1 0 16.4 12" /><path d="M16.2 3.5v3.9h-3.9" /></>,
    scale: <><path d="M3 10h7v7H3z" /><path d="M7 3h10v10M11 9l6-6M13 3h4v4" /></>,
    align: <><path d="M3 16h14" /><rect x="4.5" y="9" width="4" height="7" /><rect x="11.5" y="5" width="4" height="11" /></>,
    mirror: <><path d="M10 2.5v15" strokeDasharray="2 2" /><path d="M7.5 5.5L3 14.5h4.5zM12.5 5.5l4.5 9h-4.5z" /></>,
    offset: <><path d="M3 15c2-6 5-8.5 14-9" /><path d="M3 11c1.6-4.4 3.8-6.2 11-6.7" strokeDasharray="2 2" /></>,
    trim: <><path d="M10 3v14M3 10h7" /><path d="M11.5 10h5.5" strokeDasharray="1.5 2" /><path d="M13 7.5l2.5 5M15.5 7.5l-2.5 5" /></>,
    extend: <><path d="M16.5 3v14M3 10h7.5" /><path d="M10.5 10h4.8" strokeDasharray="1.5 2" /><path d="M13 8l2.5 2-2.5 2" /></>,
    fillet: <path d="M4 3.5V10a6.5 6.5 0 0 0 6.5 6.5h6" />,
    chamfer: <path d="M4 3.5v8l5 5h7.5" />,
    blend: <path d="M3 5h5c4 0 3 10 7 10h2" />,
    array: <><rect x="3" y="3" width="4" height="4" /><rect x="8" y="3" width="4" height="4" /><rect x="13" y="3" width="4" height="4" /><rect x="3" y="8" width="4" height="4" /><rect x="8" y="8" width="4" height="4" /><rect x="13" y="8" width="4" height="4" /><rect x="3" y="13" width="4" height="4" /><rect x="8" y="13" width="4" height="4" /><rect x="13" y="13" width="4" height="4" /></>,
    arrayPolar: <><circle cx="10" cy="10" r="1.2" /><rect x="8.5" y="2" width="3" height="3" /><rect x="15" y="8.5" width="3" height="3" /><rect x="8.5" y="15" width="3" height="3" /><rect x="2" y="8.5" width="3" height="3" /></>,
    arrayPath: <><path d="M3 16c3-9 9-9 14-12" strokeDasharray="1.5 2" /><rect x="3" y="12" width="3" height="3" /><rect x="8.5" y="7.5" width="3" height="3" /><rect x="14" y="3.5" width="3" height="3" /></>,
    arrayEdit: <><rect x="3" y="3" width="4" height="4" /><rect x="8" y="3" width="4" height="4" /><rect x="3" y="8" width="4" height="4" /><path d="M10 16.5l1-3.2 5.2-5.2 2.2 2.2-5.2 5.2z" /></>,
    break: <path d="M3 10h5M12 10h5M8 7.5l-1 5M13 7.5l-1 5" />,
    breakAtPoint: <><path d="M3 10h14" /><circle cx="10" cy="10" r="2" /></>,
    stretch: <><path d="M3 5h6v10H3" /><path d="M9 5l5 0v10H9" strokeDasharray="1.5 2" /><path d="M12 10h5M15 8l2 2-2 2" /></>,
    lengthen: <><path d="M3 10h9" /><path d="M12 10h5M15 8l2 2-2 2" strokeDasharray="1.5 0" /><path d="M3 7v6" /></>,
    join: <><path d="M3 14.5L8 9h4l5 5.5" /><circle cx="8" cy="9" r="1" /><circle cx="12" cy="9" r="1" /></>,
    explode: <><rect x="7.5" y="7.5" width="5" height="5" /><path d="M6 6L3.5 3.5M14 6l2.5-2.5M6 14l-2.5 2.5M14 14l2.5 2.5" /></>,
    erase: <><path d="M4.5 12.5l7-7 4.5 4.5-6 6H7.5z" /><path d="M8.5 16h8" /></>,
    // Edit
    undo: <><path d="M7.5 5L4 8.5 7.5 12" /><path d="M4 8.5h8a4.5 4.5 0 0 1 0 9H8" /></>,
    redo: <><path d="M12.5 5L16 8.5 12.5 12" /><path d="M16 8.5H8a4.5 4.5 0 0 0 0 9h4" /></>,
    cut: <><circle cx="6" cy="14.5" r="2.5" /><circle cx="14" cy="14.5" r="2.5" /><path d="M7.7 12.6L14.5 3M12.3 12.6L5.5 3" /></>,
    clipboard: <><rect x="4.5" y="4" width="11" height="13.5" rx="1" /><path d="M7.5 4V2.5h5V4M7.5 9h5M7.5 12.5h5" /></>,
    // Files and app
    new: <><path d="M5 2.75h7l3 3V17.25H5z" /><path d="M12 2.75v3h3M10 8.5v5M7.5 11h5" /></>,
    open: <><path d="M2.75 6.5h5l1.5-2h7v2" /><path d="m3 7.5 1.4 8.25h11.2L17 7.5z" /></>,
    save: <><path d="M4 2.75h10l2 2v12.5H4z" /><path d="M7 2.75v5h6v-5M7 17.25v-5h6v5" /></>,
    plot: <><path d="M5 7V2.75h10V7M5 14H3.25V7h13.5v7H15" /><path d="M5 11h10v6.25H5zM13.75 9h.01" /></>,
    update: <><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" /><path d="M4 14.5v2h12v-2" /></>,
    settings: <><circle cx="10" cy="10" r="2.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>,
    gear: <><path d="M15.53 8.62L17.51 8.81 17.51 11.19 15.53 11.38 14.89 12.94 16.15 14.47 14.47 16.15 12.94 14.89 11.38 15.53 11.19 17.51 8.81 17.51 8.62 15.53 7.06 14.89 5.53 16.15 3.85 14.47 5.11 12.94 4.47 11.38 2.49 11.19 2.49 8.81 4.47 8.62 5.11 7.06 3.85 5.53 5.53 3.85 7.06 5.11 8.62 4.47 8.81 2.49 11.19 2.49 11.38 4.47 12.94 5.11 14.47 3.85 16.15 5.53 14.89 7.06z" strokeLinejoin="round" /><circle cx="10" cy="10" r="2.3" /></>,
    help: <><circle cx="10" cy="10" r="7.25" /><path d="M7.7 7.9a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.6" /><circle cx="10" cy="14.4" r=".6" fill="currentColor" /></>,
    import: <><path d="M10 2.75v9M6.75 8.5 10 11.75l3.25-3.25" /><path d="M3.25 12.5v4.75h13.5V12.5" /></>,
    export: <><path d="M10 11.75v-9M6.75 6 10 2.75 13.25 6" /><path d="M3.25 12.5v4.75h13.5V12.5" /></>,
    draftingSettings: <><path d="M3 3.5h14v4H3z" /><path d="M5.5 3.5v2M8 3.5v1.2M10.5 3.5v2M13 3.5v1.2M15.5 3.5v2" /><path d="M3 11h14M3 14.5h14M7 9.5v7M13 9.5v7" strokeDasharray="1 1.5" /></>,
    trackingPoint: <><path d="M10 3v4.5M10 12.5V17M3 10h4.5M12.5 10H17" /><path d="M8.2 8.2l3.6 3.6M11.8 8.2l-3.6 3.6" /></>,
    search: <><circle cx="9" cy="9" r="5.5" /><path d="M13 13l4 4" /></>,
    close: <path d="M5 5l10 10M15 5L5 15" />,
    plus: <path d="M10 4v12M4 10h12" />,
    minus: <path d="M4 10h12" />,
    check: <path d="M4 10.5l4 4 8-9" />,
    chevronDown: <path d="M5.5 8l4.5 4.5L14.5 8" />,
    chevronRight: <path d="M8 5.5l4.5 4.5L8 14.5" />,
    chevronLeft: <path d="M12 5.5L7.5 10l4.5 4.5" />,
    chevronUp: <path d="M5.5 12L10 7.5l4.5 4.5" />,
    moreVertical: <><circle cx="10" cy="5" r=".8" fill="currentColor" /><circle cx="10" cy="10" r=".8" fill="currentColor" /><circle cx="10" cy="15" r=".8" fill="currentColor" /></>,
    sidebarCollapse: <><rect x="3" y="4" width="14" height="12" rx="1" /><path d="M12.5 4v12M7 8l2 2-2 2" /></>,
    sidebarExpand: <><rect x="3" y="4" width="14" height="12" rx="1" /><path d="M12.5 4v12M9 8l-2 2 2 2" /></>,
    drag: <><circle cx="7.5" cy="6" r=".8" fill="currentColor" /><circle cx="12.5" cy="6" r=".8" fill="currentColor" /><circle cx="7.5" cy="10" r=".8" fill="currentColor" /><circle cx="12.5" cy="10" r=".8" fill="currentColor" /><circle cx="7.5" cy="14" r=".8" fill="currentColor" /><circle cx="12.5" cy="14" r=".8" fill="currentColor" /></>,
    manage: <><path d="M3.5 5.5h7M14.5 5.5h2M3.5 10h2M9.5 10h7M3.5 14.5h7M14.5 14.5h2" /><circle cx="12.5" cy="5.5" r="1.8" /><circle cx="7.5" cy="10" r="1.8" /><circle cx="12.5" cy="14.5" r="1.8" /></>,
    link: <><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" /></>,
    info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.5v.01" /></>,
    more: <><circle cx="5" cy="10" r=".8" fill="currentColor" /><circle cx="10" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /></>,
    // Layers and objects
    eye: <><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" /><circle cx="10" cy="10" r="2" /></>,
    eyeOff: <><path d="M4.5 6.6C3.2 7.9 2.5 10 2.5 10s2.8 5 7.5 5c1.3 0 2.4-.4 3.4-.9M8 5.3c.6-.2 1.3-.3 2-.3 4.7 0 7.5 5 7.5 5s-.6 1.1-1.7 2.3M3 3l14 14" /></>,
    lock: <><rect x="5" y="9" width="10" height="7.5" rx="1" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
    unlock: <><rect x="5" y="9" width="10" height="7.5" rx="1" /><path d="M7 9V6.5a3 3 0 0 1 5.8-1" /></>,
    freeze: <path d="M10 2.5v15M3.5 6.2l13 7.6M3.5 13.8l13-7.6" />,
    noPlot: <><path d="M5 7V2.75h10V7M5 14H3.25V7h13.5v7H15" /><path d="M5 11h10v6.25H5z" /><path d="M2.5 2.5l15 15" /></>,
    layerAdd: <><path d="M9 3l7.5 4-7.5 4-7.5-4zM1.5 10.5l7.5 4 2.5-1.3" /><path d="M15.5 11.5v6M12.5 14.5h6" /></>,
    layers: <path d="M10 3l7.5 4-7.5 4-7.5-4zM2.5 10.5l7.5 4 7.5-4M2.5 13.5l7.5 4 7.5-4" />,
    blocks: <><rect x="3" y="3" width="6" height="6" /><rect x="11" y="3" width="6" height="6" /><rect x="3" y="11" width="6" height="6" /><circle cx="14" cy="14" r="3" /></>,
    properties: <path d="M4 5h12M4 10h12M4 15h12M7 3.5v3M13 8.5v3M9 13.5v3" />,
    viewport: <><rect x="3" y="4" width="14" height="12" /><path d="M6 13l3-4 2 2.5 1.5-1.5 2 3" /></>,
};

export const DRAWING_ICON_NAMES = Object.freeze(Object.keys(ICONS));

export default function Icon({ name, size = 'md', className = '' }) {
    const shape = ICONS[name];
    if (!shape) return null;
    return (
        <svg className={['ui-icon', size === 'sm' && 'is-small', className].filter(Boolean).join(' ')} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            {shape}
        </svg>
    );
}
