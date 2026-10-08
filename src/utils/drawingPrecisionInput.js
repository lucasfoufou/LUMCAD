const LENGTH_UNIT_FACTORS = Object.freeze({
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    millimetre: 0.001,
    millimetres: 0.001,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    centimetre: 0.01,
    centimetres: 0.01,
    m: 1,
    meter: 1,
    meters: 1,
    metre: 1,
    metres: 1,
    km: 1_000,
    kilometer: 1_000,
    kilometers: 1_000,
    kilometre: 1_000,
    kilometres: 1_000,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
});

const ANGLE_UNIT_FACTORS = Object.freeze({
    deg: 1,
    degree: 1,
    degrees: 1,
    rad: 180 / Math.PI,
    radian: 180 / Math.PI,
    radians: 180 / Math.PI,
    gon: 0.9,
    grad: 0.9,
    gradians: 0.9,
});
const MILLIMETRE_UNIT_FACTORS = Object.freeze(Object.fromEntries(
    Object.entries(LENGTH_UNIT_FACTORS).map(([unit, factor]) => [unit, factor * 1_000]),
));

const EXPRESSION_FUNCTIONS = Object.freeze({
    abs: values => values.length === 1 ? Math.abs(values[0]) : null,
    ceil: values => values.length === 1 ? Math.ceil(values[0]) : null,
    floor: values => values.length === 1 ? Math.floor(values[0]) : null,
    max: values => values.length > 0 ? Math.max(...values) : null,
    min: values => values.length > 0 ? Math.min(...values) : null,
    pow: values => values.length === 2 ? Math.pow(values[0], values[1]) : null,
    round: values => values.length === 1 ? Math.round(values[0]) : null,
    sqrt: values => values.length === 1 && values[0] >= 0 ? Math.sqrt(values[0]) : null,
});

const CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });
const MAX_EXPRESSION_LENGTH = 512;
const MAX_EXPRESSION_DEPTH = 64;
const MAX_ABSOLUTE_RESULT = 1e15;

export function evaluateDrawingExpression(value, {
    variables = {},
    resolveVariable,
    onVariable,
    unitType = 'length',
    lengthUnit = 'm',
    angleUnit = 'degrees',
    decimalComma = false,
} = {}) {
    const source = normalizeExpressionSource(value, decimalComma);
    if (!source || source.length > MAX_EXPRESSION_LENGTH) {
        throw precisionInputError(source ? 'expressionTooLong' : 'expressionRequired');
    }
    const units = unitType === 'angle'
        ? angleUnitFactors(angleUnit)
        : lengthUnit === 'mm' ? MILLIMETRE_UNIT_FACTORS : LENGTH_UNIT_FACTORS;
    const wholeAngleUnit = unitType === 'angle' ? splitWholeExpressionAngleUnit(source, units) : null;
    const parser = createExpressionParser(tokenizeExpression(wholeAngleUnit?.expression || source), {
        variables: normalizeDrawingVariables(variables),
        resolveVariable,
        onVariable,
        units,
    });
    const result = parser.parse() * (wholeAngleUnit?.factor || 1);
    if (!Number.isFinite(result) || Math.abs(result) > MAX_ABSOLUTE_RESULT) {
        throw precisionInputError('resultOutOfRange');
    }
    return result;
}

/** Rename parsed variable references without touching units, functions or numeric exponents. */
export function remapDrawingExpressionVariables(value, names, options = {}) {
    const source = normalizeExpressionSource(value, options.decimalComma);
    const edits = [];
    evaluateDrawingExpression(source, { ...options, onVariable: (name, start, end) => {
        const replacement = names.get(name);
        if (replacement === undefined || replacement === name) return;
        if (!/^[a-z_][a-z0-9_]{0,63}$/.test(replacement) || Object.hasOwn(CONSTANTS, replacement)) {
            throw precisionInputError('invalidExpression');
        }
        edits.push({ start, end, replacement });
    } });
    let result = source;
    for (const { start, end, replacement } of edits.reverse()) result = result.slice(0, start) + replacement + result.slice(end);
    if (result.length > MAX_EXPRESSION_LENGTH) throw precisionInputError('expressionTooLong');
    return result;
}

export function parseDrawingPointInput(value, {
    referencePoint = null,
    variables = {},
    decimalComma = false,
    lengthUnit = 'm',
    angleUnit = 'degrees',
} = {}) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const relative = source.startsWith('@');
    const explicitlyAbsolute = source.startsWith('#');
    const body = relative || explicitlyAbsolute ? source.slice(1).trim() : source;
    const polarSeparator = findTopLevelSeparator(body, '<');
    if (polarSeparator >= 0) {
        const parts = splitAtIndex(body, polarSeparator);
        if (!relative || !isFinitePoint(referencePoint)) throw precisionInputError('relativeReferenceRequired');
        const distance = evaluateDrawingExpression(parts[0], { variables, decimalComma, lengthUnit });
        const angle = evaluateDrawingExpression(parts[1], {
            variables,
            unitType: 'angle',
            angleUnit,
            decimalComma,
        });
        if (distance <= 0) throw precisionInputError('distancePositive');
        const radians = angleToRadians(angle, angleUnit);
        return {
            kind: 'relativePolar',
            point: {
                x: referencePoint.x + Math.cos(radians) * distance,
                y: referencePoint.y + Math.sin(radians) * distance,
            },
            distance,
            angle,
        };
    }

    const coordinateParts = splitCoordinateParts(body, {
        decimalComma,
        explicit: relative || explicitlyAbsolute,
    });
    if (!coordinateParts) return null;
    if (coordinateParts.length !== 2 || coordinateParts.some(part => !part.trim())) {
        throw precisionInputError('coordinatePairRequired');
    }
    const x = evaluateDrawingExpression(coordinateParts[0], { variables, decimalComma, lengthUnit });
    const y = evaluateDrawingExpression(coordinateParts[1], { variables, decimalComma, lengthUnit });
    if (relative && !isFinitePoint(referencePoint)) throw precisionInputError('relativeReferenceRequired');
    return {
        kind: relative ? 'relativeCartesian' : 'absoluteCartesian',
        point: relative
            ? { x: referencePoint.x + x, y: referencePoint.y + y }
            : { x, y },
        components: { x, y },
    };
}

export function hasDrawingPointSyntax(value, { decimalComma = false } = {}) {
    const source = String(value ?? '').trim();
    if (!source) return false;
    const explicit = source.startsWith('@') || source.startsWith('#');
    const body = explicit ? source.slice(1).trim() : source;
    try {
        return findTopLevelSeparator(body, '<') >= 0
            || Boolean(splitCoordinateParts(body, { decimalComma, explicit }));
    } catch {
        return explicit || /[,;<]/.test(body);
    }
}

export function resolveDrawingPointInput(value, {
    referencePoint = null,
    directionPoint = null,
    variables = {},
    decimalComma = false,
    allowDirectDistance = true,
    lengthUnit = 'm',
    angleUnit = 'degrees',
} = {}) {
    const source = String(value ?? '').trim();
    if (!source) return { matched: false };
    try {
        const coordinate = parseDrawingPointInput(source, {
            referencePoint,
            variables,
            decimalComma,
            lengthUnit,
            angleUnit,
        });
        if (coordinate) return { matched: true, valid: true, ...coordinate };
        if (!allowDirectDistance) return { matched: false };
        if (!isDrawingExpressionInput(source, variables)) return { matched: false };
        const distance = evaluateDrawingExpression(source, { variables, decimalComma, lengthUnit });
        if (!isFinitePoint(referencePoint)) {
            return { matched: true, valid: false, error: 'directDistanceReferenceRequired' };
        }
        if (distance <= 0) return { matched: true, valid: false, error: 'distancePositive' };
        const dx = Number(directionPoint?.x) - referencePoint.x;
        const dy = Number(directionPoint?.y) - referencePoint.y;
        const directionLength = Math.hypot(dx, dy);
        if (!Number.isFinite(directionLength) || directionLength <= Number.EPSILON) {
            return { matched: true, valid: false, error: 'directDistanceDirectionRequired' };
        }
        return {
            matched: true,
            valid: true,
            kind: 'directDistance',
            distance,
            point: {
                x: referencePoint.x + dx / directionLength * distance,
                y: referencePoint.y + dy / directionLength * distance,
            },
        };
    } catch (error) {
        return {
            matched: true,
            valid: false,
            error: error?.precisionInputCode || 'invalidExpression',
        };
    }
}

export function evaluateDrawingCalculation(value, variables = {}, options = {}) {
    const source = String(value ?? '').trim();
    const assignment = parseDrawingVariableAssignment(source);
    if (!assignment) {
        return {
            value: evaluateDrawingExpression(source, { ...options, variables }),
            variables: normalizeDrawingVariables(variables),
            variable: null,
        };
    }
    if (Object.hasOwn(CONSTANTS, assignment.name)) throw precisionInputError('reservedVariable');
    const result = evaluateDrawingExpression(assignment.expression, { ...options, variables });
    return {
        value: result,
        variables: { ...normalizeDrawingVariables(variables), [assignment.name]: result },
        variable: assignment.name,
    };
}

export function normalizeDrawingVariables(variables) {
    const entries = variables instanceof Map ? [...variables.entries()] : Object.entries(variables || {});
    return Object.fromEntries(entries.flatMap(([rawName, rawValue]) => {
        const name = normalizeVariableName(rawName);
        const value = Number(rawValue);
        return name && Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_RESULT
            ? [[name, value]]
            : [];
    }));
}

export function drawingDynamicInputAnchor(point, viewBox, viewportSize, {
    offset = 14,
    margin = 8,
    width = 190,
    height = 34,
} = {}) {
    if (!isFinitePoint(point)) return null;
    const viewportWidth = Number(viewportSize?.width);
    const viewportHeight = Number(viewportSize?.height);
    const viewWidth = Number(viewBox?.width);
    const viewHeight = Number(viewBox?.height);
    if (![viewportWidth, viewportHeight, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) return null;
    const scale = Math.min(viewportWidth / viewWidth, viewportHeight / viewHeight);
    const renderedWidth = viewWidth * scale;
    const renderedHeight = viewHeight * scale;
    const renderedOffsetX = (viewportWidth - renderedWidth) / 2;
    const renderedOffsetY = (viewportHeight - renderedHeight) / 2;
    const x = renderedOffsetX + (point.x - Number(viewBox.x || 0)) * scale + offset;
    const y = renderedOffsetY + (point.y - Number(viewBox.y || 0)) * scale + offset;
    return {
        x: clamp(x, margin, Math.max(margin, viewportWidth - width - margin)),
        y: clamp(y, margin, Math.max(margin, viewportHeight - height - margin)),
    };
}

export function precisionInputError(code) {
    const error = new Error(code);
    error.precisionInputCode = code;
    return error;
}

function normalizeExpressionSource(value, decimalComma) {
    const source = String(value ?? '').trim();
    if (!decimalComma) return source;
    return source.replace(/(\d),(?=\d)/g, '$1.');
}

function angleUnitFactors(targetUnit) {
    const targetFactor = targetUnit === 'radians'
        ? Math.PI / 180
        : targetUnit === 'gradians' ? 10 / 9 : 1;
    return Object.fromEntries(Object.entries(ANGLE_UNIT_FACTORS).map(([unit, factor]) => (
        [unit, factor * targetFactor]
    )));
}

function angleToRadians(value, unit) {
    if (unit === 'radians') return value;
    if (unit === 'gradians') return value * Math.PI / 200;
    return value * Math.PI / 180;
}

function splitWholeExpressionAngleUnit(source, units) {
    const match = source.match(/^(.*\S)\s+(deg(?:ree)?s?|rad(?:ian)?s?|gon|grad(?:ian)?s?|°)\s*$/i);
    if (!match) return null;
    const expression = match[1].trim();
    if (/(?:^|[^a-zA-Z_])(?:deg(?:ree)?s?|rad(?:ian)?s?|gon|grad(?:ian)?s?)(?:$|[^a-zA-Z0-9_])|°/i.test(expression)) {
        return null;
    }
    const unit = match[2].toLowerCase();
    const factor = units[unit];
    return Number.isFinite(factor) ? { expression, factor } : null;
}

function tokenizeExpression(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        if (/\s/.test(char)) {
            index += 1;
            continue;
        }
        if (/\d|\./.test(char)) {
            const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/);
            if (!match) throw precisionInputError('invalidExpression');
            tokens.push({ type: 'number', value: Number(match[0]) });
            index += match[0].length;
            continue;
        }
        if (/[a-zA-Z_]/.test(char)) {
            const match = source.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            tokens.push({ type: 'identifier', value: match[0].toLowerCase(), start: index, end: index + match[0].length });
            index += match[0].length;
            continue;
        }
        if ('+-*/%^(),;'.includes(char)) {
            const type = char === ';' ? ',' : char;
            tokens.push({ type, value: type });
            index += 1;
            continue;
        }
        if (char === '\'' || char === '"' || char === '°') {
            tokens.push({ type: 'unit', value: char });
            index += 1;
            continue;
        }
        throw precisionInputError('invalidExpression');
    }
    tokens.push({ type: 'end' });
    return tokens;
}

function createExpressionParser(tokens, { variables, units, resolveVariable, onVariable }) {
    let position = 0;
    let depth = 0;
    const current = () => tokens[position];
    const take = type => {
        if (current().type !== type) return null;
        const token = current();
        position += 1;
        return token;
    };
    const enter = callback => {
        depth += 1;
        if (depth > MAX_EXPRESSION_DEPTH) throw precisionInputError('expressionTooDeep');
        const result = callback();
        depth -= 1;
        return result;
    };
    const parsePrimary = () => enter(() => {
        if (take('(')) {
            const value = parseAddition();
            if (!take(')')) throw precisionInputError('invalidExpression');
            return applyUnit(value);
        }
        const number = take('number');
        if (number) return applyUnit(number.value);
        const identifier = take('identifier');
        if (!identifier) throw precisionInputError('invalidExpression');
        if (take('(')) {
            const values = [];
            if (current().type !== ')') {
                do values.push(parseAddition()); while (take(','));
            }
            if (!take(')')) throw precisionInputError('invalidExpression');
            const fn = EXPRESSION_FUNCTIONS[identifier.value];
            const value = fn?.(values);
            if (!Number.isFinite(value)) throw precisionInputError('invalidFunction');
            return applyUnit(value);
        }
        if (Object.hasOwn(CONSTANTS, identifier.value)) return applyUnit(CONSTANTS[identifier.value]);
        onVariable?.(identifier.value, identifier.start, identifier.end);
        const value = Object.hasOwn(variables, identifier.value) ? variables[identifier.value]
            : typeof resolveVariable === 'function' ? resolveVariable(identifier.value) : undefined;
        if (!Number.isFinite(value)) throw precisionInputError('unknownVariable');
        return applyUnit(value);
    });
    const applyUnit = value => {
        const token = current();
        const unitName = token.type === 'identifier'
            ? token.value
            : token.type === 'unit'
                ? token.value
                : null;
        if (!unitName) return value;
        const normalized = unitName === '\'' ? 'ft' : unitName === '"' ? 'in' : unitName === '°' ? 'deg' : unitName;
        const factor = units[normalized];
        if (!Number.isFinite(factor)) return value;
        position += 1;
        return value * factor;
    };
    const parseUnary = () => {
        if (take('+')) return parseUnary();
        if (take('-')) return -parseUnary();
        return parsePrimary();
    };
    const parsePower = () => {
        const left = parseUnary();
        return take('^') ? Math.pow(left, parsePower()) : left;
    };
    const parseMultiplication = () => {
        let value = parsePower();
        while (['*', '/', '%'].includes(current().type)) {
            const operator = current().type;
            position += 1;
            const right = parsePower();
            if ((operator === '/' || operator === '%') && right === 0) throw precisionInputError('divisionByZero');
            if (operator === '*') value *= right;
            else if (operator === '/') value /= right;
            else value %= right;
        }
        return value;
    };
    const parseAddition = () => {
        let value = parseMultiplication();
        while (current().type === '+' || current().type === '-') {
            const operator = current().type;
            position += 1;
            const right = parseMultiplication();
            value = operator === '+' ? value + right : value - right;
        }
        return value;
    };
    return {
        parse() {
            const value = parseAddition();
            if (current().type !== 'end') throw precisionInputError('invalidExpression');
            return value;
        },
    };
}

function splitCoordinateParts(source, { decimalComma, explicit }) {
    const semicolons = findAllTopLevelSeparators(source, ';');
    if (semicolons.length) return splitAtSeparators(source, semicolons);
    const topLevelCommas = findAllTopLevelSeparators(source, ',');
    const commas = decimalComma && !explicit
        ? topLevelCommas.filter(index => !isDecimalComma(source, index))
        : topLevelCommas;
    if (!commas.length) return null;
    return splitAtSeparators(source, commas);
}

function isDecimalComma(source, index) {
    return /\d/.test(source[index - 1] || '') && /\d/.test(source[index + 1] || '');
}

function findTopLevelSeparator(source, separator) {
    return findAllTopLevelSeparators(source, separator)[0] ?? -1;
}

function findAllTopLevelSeparators(source, separator) {
    const indexes = [];
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') depth -= 1;
        else if (source[index] === separator && depth === 0) indexes.push(index);
        if (depth < 0) throw precisionInputError('invalidExpression');
    }
    if (depth !== 0) throw precisionInputError('invalidExpression');
    return indexes;
}

function splitAtSeparators(source, indexes) {
    const parts = [];
    let start = 0;
    indexes.forEach(index => {
        parts.push(source.slice(start, index));
        start = index + 1;
    });
    parts.push(source.slice(start));
    return parts;
}

function splitAtIndex(source, index) {
    const parts = [source.slice(0, index), source.slice(index + 1)];
    if (parts.some(part => !part.trim())) throw precisionInputError('polarValuesRequired');
    return parts;
}

function parseDrawingVariableAssignment(source) {
    const match = source.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (!match) return null;
    return { name: normalizeVariableName(match[1]), expression: match[2] };
}

function normalizeVariableName(value) {
    const name = String(value || '').trim().toLowerCase();
    return /^[a-z_][a-z0-9_]*$/.test(name) ? name : null;
}

export function isDrawingExpressionInput(value, variables = {}) {
    const source = String(value || '').trim();
    if (!source) return false;
    if (/^[+\-]?(?:\d|\.\d)/.test(source) || /^[([]/.test(source)) return true;
    const identifier = source.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)?.[0]?.toLowerCase();
    return Boolean(identifier && (Object.hasOwn(normalizeDrawingVariables(variables), identifier)
        || Object.hasOwn(CONSTANTS, identifier)
        || Object.hasOwn(EXPRESSION_FUNCTIONS, identifier)));
}

function isFinitePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
