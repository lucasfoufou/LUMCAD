#!/usr/bin/env node
// Headless performance benchmark of the document pipeline that every editor
// interaction goes through. Usage: npm run bench -- [S M L XL] [--json file]
import { writeFileSync } from 'node:fs';

import { createDrawingBenchmarkDocument, DRAWING_BENCHMARK_FIXTURES } from '../src/utils/drawingBenchmarkFixtures.js';
import { createDimensionSourceMap } from '../src/utils/drawingDimensionSources.js';
import { commitDrawingHistoryState } from '../src/utils/drawingHistory.js';
import { drawingSelectionCandidates } from '../src/utils/drawingInteraction.js';
import { createSelectionWindow } from '../src/utils/drawingSelection.js';
import { resolveDrawingSnap } from '../src/utils/drawingTracking.js';
import { createLcadArchive, readLcadArchive } from '../src/utils/lcadArchive.js';
import { createLcadEnvelope } from '../src/utils/lcadDocument.js';

const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--json');
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const sizes = args.filter((arg, index) => !arg.startsWith('--') && (jsonIndex < 0 || index !== jsonIndex + 1));
const selectedSizes = sizes.length ? sizes : Object.keys(DRAWING_BENCHMARK_FIXTURES);

const results = [];
for (const size of selectedSizes) results.push(benchmarkFixture(size));
printResults(results);
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2)}\n`);

function benchmarkFixture(size) {
    const heapBefore = heapUsed();
    const document = createDrawingBenchmarkDocument(size);
    const documentHeap = heapUsed() - heapBefore;
    const { content } = document;
    const bounds = contentBounds(content);
    const envelope = createLcadEnvelope(document);
    const archive = tryCreateArchive(envelope);
    const iterations = content.entities.length > 20_000 ? 5 : 10;
    const metrics = {
        open: archive.error ? archive : measure(() => readLcadArchive(archive), iterations),
        save: archive.error ? archive : measure(() => createLcadArchive(envelope), iterations),
        serializeDocument: measure(() => JSON.stringify(document), iterations),
        sceneSourceMap: measure(() => createDimensionSourceMap(content.entities, content.blocks, content), iterations),
        commitOneEntity: measure(() => commitDrawingHistoryState(historyOf(document), moveEntities(document, 1)), iterations),
        commitTenPercent: measure(() => commitDrawingHistoryState(historyOf(document), moveEntities(document, Math.ceil(content.entities.length / 10))), iterations),
        snapPointerMove: measurePointer(point => resolveDrawingSnap(point, content, 0.1), bounds, 40),
        snapAfterEdit: measure(() => resolveDrawingSnap(bounds.center, { ...content, entities: [...content.entities] }, 0.1), iterations),
        snapPointerMoveTracking: measurePointer(point => resolveDrawingSnap(point, { ...content, settings: { ...content.settings, tracking: true, polarTracking: true } }, 0.1, {
            trackingAnchors: [{ x: bounds.minX + 1, y: bounds.minY + 1, type: 'endpoint' }],
            orthogonalOrigin: { x: bounds.minX, y: bounds.minY },
        }), bounds, 40),
        windowSelectionQuarter: measure(() => drawingSelectionCandidates(content, createSelectionWindow(
            { x: bounds.minX + bounds.width * 0.5, y: bounds.minY },
            { x: bounds.minX, y: bounds.minY + bounds.height * 0.5 },
        )), iterations),
    };
    return {
        size,
        entities: content.entities.length,
        archiveKiB: archive.error ? archive.error : Math.round(archive.byteLength / 1024),
        jsonKiB: Math.round(JSON.stringify(document).length / 1024),
        documentHeapMiB: round(documentHeap / 1024 / 1024),
        metrics,
    };
}

function tryCreateArchive(envelope) {
    try {
        return createLcadArchive(envelope);
    } catch (error) {
        return { error: error.translationKey || error.message };
    }
}

function historyOf(document) {
    return { past: [], present: document, future: [], coalesceKey: null };
}

function moveEntities(document, count) {
    let moved = 0;
    const entities = document.content.entities.map(entity => {
        if (moved >= count || entity.type !== 'circle') return entity;
        moved += 1;
        return { ...entity, cx: entity.cx + 0.01 };
    });
    return { ...document, content: { ...document.content, entities } };
}

function measurePointer(run, bounds, samples) {
    const points = Array.from({ length: samples }, (_, index) => ({
        x: bounds.minX + bounds.width * ((index * 0.6180339887) % 1),
        y: bounds.minY + bounds.height * ((index * 0.7548776662) % 1),
    }));
    let index = 0;
    return measure(() => run(points[index++ % points.length]), samples);
}

function measure(run, iterations) {
    run();
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    return { median: round(samples[Math.floor(samples.length / 2)]), p95: round(samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]) };
}

function contentBounds(content) {
    const xs = [];
    const ys = [];
    for (const entity of content.entities) {
        if (entity.type === 'rectangle') {
            xs.push(entity.x, entity.x + entity.width);
            ys.push(entity.y, entity.y + entity.height);
        }
    }
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const height = Math.max(...ys) - minY;
    return { minX, minY, width, height, center: { x: minX + width / 2, y: minY + height / 2 } };
}

function heapUsed() {
    globalThis.gc?.();
    return process.memoryUsage().heapUsed;
}

function round(value) {
    return Math.round(value * 100) / 100;
}

function printResults(rows) {
    const metricNames = Object.keys(rows[0].metrics);
    console.log(`\nLUMCAD document pipeline benchmark — ${process.version}\n`);
    console.table(Object.fromEntries(rows.map(row => [row.size, {
        entities: row.entities,
        'archive KiB': row.archiveKiB,
        'JSON KiB': row.jsonKiB,
        'heap MiB': row.documentHeapMiB,
    }])));
    console.log('Median / p95 in milliseconds per operation:');
    console.table(Object.fromEntries(metricNames.map(name => [name, Object.fromEntries(rows.map(row => [
        row.size, row.metrics[name].error || `${row.metrics[name].median} / ${row.metrics[name].p95}`,
    ]))])));
}
