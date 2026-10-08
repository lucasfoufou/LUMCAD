/** Flatten neutral export groups after computed styles have been materialized.
 * Retain transforms on their painted children.
 * WebKit's SVG image renderer can cull tiny geometry inside transformed groups.
 * Compositing/clip groups and referenced groups must retain their boundaries.
 */
export function flattenDrawingSvgGroups(root) {
    const property = (element, name) => element.style?.getPropertyValue(name) || element.getAttribute(name);
    const walk = parent => {
        let referenced = parent.hasAttribute('id');
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType !== 1 || child.localName === 'defs') continue;
            const childReferenced = walk(child);
            referenced ||= childReferenced;
            // Moving an ancestor transform into an ID target changes <use> instances.
            if (child.localName !== 'g' || childReferenced) continue;
            const opacity = property(child, 'opacity');
            if ((opacity && Number(opacity) !== 1) || property(child, 'display') === 'none'
                || ['clip-path', 'filter', 'mask', 'transform'].some(name => {
                    const value = name === 'transform' ? child.style?.getPropertyValue(name) : property(child, name);
                    return value && value !== 'none';
                })) continue;
            const transform = child.getAttribute('transform');
            for (const member of Array.from(child.childNodes)) {
                if (transform && member.nodeType === 1 && member.localName !== 'defs') {
                    member.setAttribute('transform', `${transform} ${member.getAttribute('transform') || ''}`.trim());
                }
                parent.insertBefore(member, child);
            }
            parent.removeChild(child);
        }
        return referenced;
    };
    walk(root);
}
