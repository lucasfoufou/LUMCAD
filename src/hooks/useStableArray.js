import { useRef } from 'react';

/** Keep the previous array identity while its items are unchanged, so memoized children can skip renders. */
export default function useStableArray(value) {
    const ref = useRef(value);
    const previous = ref.current;
    if (previous !== value && (previous.length !== value.length || value.some((item, index) => item !== previous[index]))) {
        ref.current = value;
    }
    return ref.current;
}
