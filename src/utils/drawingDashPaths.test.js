import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingDashPaths } from './drawingDashPaths.js';
import { curveLength, getCurveStart, getCurveEnd } from './drawingCurveKernel.js';
const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });

test('dash fragments reset phase at the marked original figure start without losing a painted join', () => {
    const paths = drawingDashPaths([{ parts: [line(10,10,10,0),line(10,0,30,0)], dashRestartAfter: 1 }], [12,4]);
    assert.deepEqual(paths[0].parts.map(p => [p.x1,p.y1,p.x2,p.y2]), [[10,10,10,0],[10,0,22,0]]);
    assert.deepEqual(getCurveStart(paths[1].parts[0]),{x:26,y:0});
});

test('dash fragments retain native cubic subcurves and bound tiny-pattern work', () => {
    const curve = {type:'spline',controlPoints:[{x:0,y:0},{x:5,y:10},{x:15,y:10},{x:20,y:0}]};
    const paths = drawingDashPaths([{parts:[curve]}],[4,3],1);
    assert.equal(paths[0].parts[0].type,'spline');
    assert.ok(Math.abs(curveLength(paths[0].parts[0])-3)<1e-6);
    assert.throws(()=>drawingDashPaths([{parts:[line(0,0,100,0)]}],[.00001,.00001],0,{maxSteps:20}),/dashLimit/);
    assert.throws(()=>drawingDashPaths([{parts:[curve]}],[0,0]),/dashPattern/);
    assert.deepEqual(getCurveEnd(drawingDashPaths([{parts:[line(0,0,20,0)]}],[3,2],-1)[0].parts[0]),{x:4,y:0});
});

test('zero-length ink produces bounded dots while zero-length gaps retain continuous joins', () => {
    const dotted = drawingDashPaths([{parts:[line(0,0,9,0)]}],[0,3]);
    assert.deepEqual(dotted.map(path=>path.dot),[{x:0,y:0},{x:3,y:0},{x:6,y:0},{x:9,y:0}]);
    const continuous = drawingDashPaths([{parts:[line(0,0,4,0),line(4,0,4,4)]}],[3,0]);
    assert.equal(continuous.length,1);
    assert.deepEqual(getCurveStart(continuous[0].parts[0]),{x:0,y:0});
    assert.deepEqual(getCurveEnd(continuous[0].parts.at(-1)),{x:4,y:4});
    assert.throws(()=>drawingDashPaths([{parts:[line(0,0,9,0)]}],[0,.000001],0,{maxSteps:10}),/dashLimit/);
});
