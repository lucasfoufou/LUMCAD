import { Resvg } from '@resvg/resvg-js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { strToU8 } from 'fflate';
import { readDrawingXpsScene, drawingXpsSceneSvg } from './drawingXpsScene.js';
const rectangle = 'M0 0H20V20H0Z';
function scene(body, options) {
    const files = new Map([['page.fpage', strToU8(`<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60">${body}</FixedPage>`)]]);
    return readDrawingXpsScene(files, { path: 'page.fpage' }, options);
}
async function pixels(value, embeddedImages = false) {
    const canvas = createCanvas(80, 60); const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 80, 60);
    const svg = drawingXpsSceneSvg(value);
    const source = embeddedImages ? new Resvg(svg).render().asPng() : Buffer.from(svg);
    context.drawImage(await loadImage(source), 0, 0);
    return (x, y) => [...context.getImageData(x, y, 1, 1).data];
}

test('XPS scene preserves nested transforms, local clipping and group opacity across overlapping paths', async () => {
    const value = scene(`<Canvas RenderTransform="1,0,0,1,10,10" Opacity="0.5" Clip="M0 0H25V20H0Z">
        <Path Data="${rectangle}" Fill="#FF0000"/>
        <Path RenderTransform="1,0,0,1,10,0" Data="${rectangle}" Fill="#00FF00"/>
    </Canvas>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(15, 15), [255, 127, 127, 255]);
    assert.deepEqual(pixel(25, 15), [127, 255, 127, 255]);
    assert.deepEqual(pixel(37, 15), [255, 255, 255, 255]);
    assert.deepEqual(pixel(5, 5), [255, 255, 255, 255]);
});

test('XPS compound even-odd fill retains holes and ARGB alpha without changing paint order', async () => {
    const value = scene('<Path Data="F0 M0 0H40V40H0Z M10 10H30V30H10Z" Fill="#800000FF"/>');
    const pixel = await pixels(value);
    assert.deepEqual(pixel(5, 5), [127, 127, 255, 255]);
    assert.deepEqual(pixel(20, 20), [255, 255, 255, 255]);
});

test('XPS stroke dash lengths and offsets scale with thickness; affine transforms remain explicit', () => {
    const value = scene('<Path Data="M0 0L20 0" Stroke="#F00" StrokeThickness="2" StrokeDashArray="2 3" StrokeDashOffset="1" RenderTransform="2 0 .5 3 4 5"/>');
    const svg = drawingXpsSceneSvg(value);
    assert.match(svg, /stroke-dasharray="4 6"/);
    assert.match(svg, /stroke-dashoffset="2"/);
    assert.match(svg, /matrix\(2 0 0.5 3 4 5\)/);
    assert.match(svg, /stroke-miterlimit="10"/);
});

test('XPS scene refuses unsupported visuals and invalid attributes rather than omitting artwork', () => {
    for (const body of ['<Glyphs/>', `<Path Data="${rectangle}" Fill="{StaticResource brush}"/>`,
        `<Path Data="${rectangle}" Opacity="2"/>`, `<Path Data="${rectangle}" StrokeStartLineCap="Triangle"/>`,
        `<Canvas RenderTransform="1,0,0,1,0"><Path Data="${rectangle}"/></Canvas>`,
        `<Path Data="${rectangle}" Unknown="ignored"/>`, `<Path Data="${rectangle}"><Path.Fill/></Path>`]) {
        assert.throws(() => scene(body), /dwfx/);
    }
    assert.throws(() => scene(`<Canvas><Path Data="${rectangle}"/></Canvas>`, { maxDepth: 1 }), /dwfxLimit/);
    assert.throws(() => scene(`<Path Data="${rectangle}"/>`, { maxParts: 3 }), /dwfxLimit/);
    assert.throws(() => scene(`<Path Data="${rectangle}"/>`, { maxNodes: 1 }), /dwfxLimit/);
});

test('inline XPS gradient paints interpolate in absolute page coordinates with independent alpha', async () => {
    const value = scene(`<Path Data="M0 0H80V60H0Z"><Path.Fill>
        <LinearGradientBrush MappingMode="Absolute" StartPoint="0,0" EndPoint="80,0" Opacity="0.5">
            <LinearGradientBrush.GradientStops><GradientStop Color="#FF0000" Offset="0"/><GradientStop Color="#0000FF" Offset="1"/></LinearGradientBrush.GradientStops>
        </LinearGradientBrush></Path.Fill></Path>`);
    const pixel = await pixels(value);
    const left = pixel(10, 20); const right = pixel(70, 20);
    assert.ok(left[0] > 230 && left[2] < 155);
    assert.ok(right[2] > 230 && right[0] < 155);
    assert.equal(left[1], 127);
    assert.equal(right[1], 127);
});

test('XPS resource lookup shadows ancestors without affecting following siblings', async () => {
    const value = scene(`<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
        <SolidColorBrush x:Key="ink" Color="#FF0000"/>
    </ResourceDictionary></FixedPage.Resources>
    <Canvas><Canvas.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="ink" Color="#0000FF"/></ResourceDictionary></Canvas.Resources>
        <Path Data="${rectangle}" Fill="{StaticResource ink}"/>
    </Canvas><Path Data="${rectangle}" RenderTransform="1 0 0 1 30 0" Fill="{StaticResource ink}"/>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(10, 10), [0, 0, 255, 255]);
    assert.deepEqual(pixel(40, 10), [255, 0, 0, 255]);
});

test('XPS external resource dictionaries resolve package-relative sources and reject cycles', () => {
    const ns = 'http://schemas.microsoft.com/xps/2005/06';
    const files = new Map([
        ['pages/a.fpage', strToU8(`<FixedPage xmlns="${ns}" Width="80" Height="60"><FixedPage.Resources><ResourceDictionary Source="../resources/a.xaml"/></FixedPage.Resources><Path Data="${rectangle}" Fill="{StaticResource ink}"/></FixedPage>`) ],
        ['resources/a.xaml', strToU8(`<ResourceDictionary xmlns="${ns}" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="ink" Color="#123456"/></ResourceDictionary>`) ],
    ]);
    assert.equal(readDrawingXpsScene(files, { path: 'pages/a.fpage' }).root.children[0].fill.color, '#123456');
    files.set('resources/a.xaml', strToU8(`<ResourceDictionary xmlns="${ns}" Source="a.xaml"/>`));
    assert.throws(() => readDrawingXpsScene(files, { path: 'pages/a.fpage' }), /dwfxResourceCycle/);
});

test('XPS brush ambiguity, duplicate keys, missing resources and invalid stops fail atomically', () => {
    for (const body of [
        `<Path Data="${rectangle}" Fill="#F00"><Path.Fill><SolidColorBrush Color="#000"/></Path.Fill></Path>`,
        `<Path Data="${rectangle}" Fill="{StaticResource missing}"/>`,
        `<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="ink" Color="#000"/><SolidColorBrush x:Key="ink" Color="#fff"/></ResourceDictionary></FixedPage.Resources>`,
        `<Path Data="${rectangle}"><Path.Fill><LinearGradientBrush MappingMode="Absolute" StartPoint="0,0" EndPoint="1,0"><LinearGradientBrush.GradientStops><GradientStop Color="#000" Offset="2"/></LinearGradientBrush.GradientStops></LinearGradientBrush></Path.Fill></Path>`,
    ]) assert.throws(() => scene(body), /dwfx/);
});

test('XPS elliptical radial gradients retain unequal radii and the focal point', async () => {
    const value = scene(`<Path Data="M0 0H80V60H0Z"><Path.Fill>
        <RadialGradientBrush MappingMode="Absolute" Center="40,30" GradientOrigin="40,30" RadiusX="30" RadiusY="15">
            <RadialGradientBrush.GradientStops><GradientStop Color="#FF0000" Offset="0"/><GradientStop Color="#0000FF" Offset="1"/></RadialGradientBrush.GradientStops>
        </RadialGradientBrush></Path.Fill></Path>`);
    const pixel = await pixels(value);
    assert.ok(pixel(40,30)[0] > 240);
    assert.deepEqual(pixel(72,30), [0,0,255,255]);
    assert.deepEqual(pixel(40,47), [0,0,255,255]);
    assert.ok(Math.abs(pixel(55,30)[0] - pixel(40,37)[0]) < 8);
});

test('radial brush transform composes after ellipse placement and external focal points reject', () => {
    const markup = origin => `<Path Data="${rectangle}"><Path.Fill><RadialGradientBrush MappingMode="Absolute" Center="10,20" GradientOrigin="${origin}" RadiusX="4" RadiusY="2" Transform="0 1 -1 0 3 5">
        <RadialGradientBrush.GradientStops><GradientStop Color="#FFF" Offset="0"/><GradientStop Color="#000" Offset="1"/></RadialGradientBrush.GradientStops>
        </RadialGradientBrush></Path.Fill></Path>`;
    const svg = drawingXpsSceneSvg(scene(markup('11,20')));
    assert.match(svg, /gradientTransform="matrix\(0 4 -2 0 -17 15\)"/);
    assert.match(svg, /fx="0.25" fy="0"/);
    assert.throws(() => scene(markup('20,20')), /dwfxUnsupported/);
});

test('published DWFx PNG image resources render through external dictionaries at the correct paper position', async () => {
    const { createDrawingDwfxPackage } = await import('./drawingPublish.js');
    const { readDrawingDwfxPackage } = await import('./drawingDwfxPackage.js');
    const canvas = createCanvas(80, 60); const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 40, 60);
    context.fillStyle = '#0000ff'; context.fillRect(40, 0, 40, 60);
    const bytes = createDrawingDwfxPackage([{ id: 'page', name: 'Image', paper: { width: 80 * 25.4 / 96, height: 60 * 25.4 / 96 }, png: new Uint8Array(canvas.toBuffer('image/png')) }]);
    const pkg = readDrawingDwfxPackage(bytes);
    const parsed = readDrawingXpsScene(pkg.files, pkg.pages[0]);
    const pixel = await pixels(parsed, true);
    assert.deepEqual(pixel(10, 30), [255, 0, 0, 255]);
    assert.deepEqual(pixel(70, 30), [0, 0, 255, 255]);
});

test('XPS image viewbox cropping and non-repeating viewport leave surrounding geometry transparent', async () => {
    const canvas = createCanvas(2, 1); const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1, 1);
    context.fillStyle = '#0000ff'; context.fillRect(1, 0, 1, 1);
    const xml = `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60"><Path Data="M0 0H80V60H0Z"><Path.Fill><ImageBrush ImageSource="image.png" Viewbox="1,0,1,1" ViewboxUnits="Absolute" Viewport="20,10,40,40" ViewportUnits="Absolute" TileMode="None"/></Path.Fill></Path></FixedPage>`;
    const files = new Map([['page', strToU8(xml)], ['image.png', new Uint8Array(canvas.toBuffer('image/png'))]]);
    const pixel = await pixels(readDrawingXpsScene(files, { path: 'page' }), true);
    assert.deepEqual(pixel(45,30), [0,0,255,255]);
    assert.deepEqual(pixel(5,30), [255,255,255,255]);
    assert.deepEqual(pixel(70,30), [255,255,255,255]);
});

test('XPS tiled image brushes preserve viewport phase and alternate reflections on both sides of the base tile', async () => {
    const canvas = createCanvas(20,20); const context = canvas.getContext('2d');
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
    colors.forEach((color, i) => { context.fillStyle = color; context.fillRect(i % 2 * 10, Math.floor(i / 2) * 10, 10, 10); });
    const expected = [[255,0,0,255], [0,255,0,255], [0,0,255,255], [255,255,0,255]];
    for (const mode of ['Tile', 'FlipX', 'FlipY', 'FlipXY']) {
        const xml = `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60"><Path Data="M0 0H80V60H0Z"><Path.Fill><ImageBrush ImageSource="image.png" Viewbox="0,0,20,20" ViewboxUnits="Absolute" Viewport="25,15,20,20" ViewportUnits="Absolute" TileMode="${mode}"/></Path.Fill></Path></FixedPage>`;
        const files = new Map([['page', strToU8(xml)], ['image.png', new Uint8Array(canvas.toBuffer('image/png'))]]);
        const value = readDrawingXpsScene(files, { path: 'page' });
        const pixel = await pixels(value, true);
        for (const column of [-1,0,1,2]) for (const row of [-1,0,1]) {
            const flipX = ['FlipX','FlipXY'].includes(mode) && Math.abs(column % 2) === 1;
            const flipY = ['FlipY','FlipXY'].includes(mode) && Math.abs(row % 2) === 1;
            assert.deepEqual(pixel(30 + column * 20,20 + row * 20), expected[Number(flipX) + Number(flipY) * 2], `${mode} column ${column}, row ${row}`);
        }
        assert.equal((drawingXpsSceneSvg(value).match(/data:image\/png;base64/g) || []).length, 1);
    }
});

test('repeating XPS image brushes paint stroke geometry while leaving its surroundings clear', async () => {
    const canvas = createCanvas(20,20); const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0,0,10,20);
    context.fillStyle = '#0000ff'; context.fillRect(10,0,10,20);
    const xml = `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60"><Path Data="M0 5H80" StrokeThickness="6"><Path.Stroke><ImageBrush ImageSource="image.png" Viewbox="0,0,20,20" ViewboxUnits="Absolute" Viewport="0,0,20,20" ViewportUnits="Absolute" TileMode="Tile"/></Path.Stroke></Path></FixedPage>`;
    const files = new Map([['page', strToU8(xml)], ['image.png', new Uint8Array(canvas.toBuffer('image/png'))]]);
    const pixel = await pixels(readDrawingXpsScene(files, { path: 'page' }), true);
    assert.deepEqual(pixel(5,5), [255,0,0,255]);
    assert.deepEqual(pixel(15,5), [0,0,255,255]);
    assert.deepEqual(pixel(25,5), [255,0,0,255]);
    assert.deepEqual(pixel(25,20), [255,255,255,255]);
});

test('XPS property and resource matrices preserve nested transform order and lexical shadowing', async () => {
    const value = scene(`<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key">
        <MatrixTransform x:Key="move" Matrix="1 0 0 1 40 0"/>
    </ResourceDictionary></FixedPage.Resources>
    <Path Data="${rectangle}" Fill="#F00" RenderTransform="{StaticResource move}"/>
    <Canvas><Canvas.RenderTransform><MatrixTransform Matrix="1 0 0 1 0 30"/></Canvas.RenderTransform>
        <Canvas.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key">
            <MatrixTransform x:Key="move" Matrix="1 0 0 1 10 0"/>
        </ResourceDictionary></Canvas.Resources>
        <Path Data="${rectangle}" Fill="#00F" RenderTransform="{StaticResource move}"/>
        <Path Data="${rectangle}" Fill="#0F0"><Path.RenderTransform><MatrixTransform Matrix="0.5 0 0 1 35 0"/></Path.RenderTransform></Path>
    </Canvas>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(45, 10), [255, 0, 0, 255]);
    assert.deepEqual(pixel(15, 40), [0, 0, 255, 255]);
    assert.deepEqual(pixel(40, 40), [0, 255, 0, 255]);
    assert.deepEqual(pixel(50, 40), [255, 255, 255, 255]);
});

test('XPS transforms reject duplicate properties, invalid matrices and resources of the wrong type', () => {
    const transform = '<Path.RenderTransform><MatrixTransform Matrix="1 0 0 1 2 3"/></Path.RenderTransform>';
    for (const body of [
        `<Path Data="${rectangle}" RenderTransform="1 0 0 1 0 0">${transform}</Path>`,
        `<Path Data="${rectangle}">${transform}${transform}</Path>`,
        `<Path Data="${rectangle}"><Path.RenderTransform><MatrixTransform Matrix="1 2 3"/></Path.RenderTransform></Path>`,
        `<Path Data="${rectangle}"><Path.RenderTransform/></Path>`,
        `<Path Data="${rectangle}" RenderTransform="{StaticResource missing}"/>`,
        `<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key"><SolidColorBrush x:Key="paint" Color="#F00"/></ResourceDictionary></FixedPage.Resources><Path Data="${rectangle}" RenderTransform="{StaticResource paint}"/>`,
        `<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key"><MatrixTransform x:Key="move" Matrix="1 0 0 1 0 0"/></ResourceDictionary></FixedPage.Resources><Path Data="${rectangle}" Fill="{StaticResource move}"/>`
    ]) assert.throws(() => scene(body), /dwfx/);
    assert.throws(() => scene(`<Path Data="${rectangle}">${transform}</Path>`, { maxNodes: 3 }), /dwfxLimit/);
});

test('expanded XPS path figures share exact curve parsing with abbreviated geometry', () => {
    const expanded = scene(`<Path Stroke="#000"><Path.Data><PathGeometry FillRule="NonZero">
        <PathFigure StartPoint="5,10" IsClosed="true"><PolyLineSegment Points="10,10 15,15"/>
            <PolyBezierSegment Points="20,5 25,5 30,15"/><PolyQuadraticBezierSegment Points="35,25 40,15"/>
            <ArcSegment Point="50,15" Size="5,10" RotationAngle="30" IsLargeArc="false" SweepDirection="Clockwise"/>
        </PathFigure></PathGeometry></Path.Data></Path>`).root.children[0].geometry;
    const abbreviated = scene('<Path Stroke="#000" Data="F1 M5 10 L10 10 15 15 C20 5 25 5 30 15 Q35 25 40 15 A5 10 30 0 1 50 15 Z"/>').root.children[0].geometry;
    assert.deepEqual(expanded.paths, abbreviated.paths);
    assert.equal(expanded.rule, abbreviated.rule);
});

test('expanded XPS geometry resources and property clips retain compound holes', async () => {
    const value = scene(`<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key">
        <PathGeometry x:Key="hole" Figures="M0 0H40V40H0Z M10 10H30V30H10Z"/>
    </ResourceDictionary></FixedPage.Resources>
    <Canvas><Canvas.Clip><PathGeometry><PathFigure StartPoint="0,0" IsClosed="true"><PolyLineSegment Points="35,0 35,40 0,40"/></PathFigure></PathGeometry></Canvas.Clip>
        <Path Data="{StaticResource hole}" Fill="#F00"/>
    </Canvas>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(5, 5), [255, 0, 0, 255]);
    assert.deepEqual(pixel(20, 20), [255, 255, 255, 255]);
    assert.deepEqual(pixel(37, 5), [255, 255, 255, 255]);
    assert.deepEqual(pixel(32, 5), [255, 0, 0, 255]);
});

test('expanded XPS geometry refuses ambiguous definitions and unsupported segment flags', () => {
    const data = geometry => `<Path Fill="#F00"><Path.Data>${geometry}</Path.Data></Path>`;
    for (const geometry of [
        '<PathGeometry Figures="F1 M0 0L1 1"/>',
        '<PathGeometry Figures="M0 0L1 1"><PathFigure StartPoint="0,0"/></PathGeometry>',
        '<PathGeometry FillRule="Bad"/>',
        '<PathGeometry><PathFigure StartPoint="0,0" IsFilled="invalid"><PolyLineSegment Points="10,10"/></PathFigure></PathGeometry>',
        '<PathGeometry><PathFigure StartPoint="0,0"><PolyLineSegment Points="10,10" IsStroked="invalid"/></PathFigure></PathGeometry>',
        '<PathGeometry><PathFigure StartPoint="0,0"><PolyBezierSegment Points="1,2 3,4"/></PathFigure></PathGeometry>',
        '<PathGeometry><PathFigure StartPoint="0,0"><ArcSegment Point="1,1" Size="-1,2" RotationAngle="0" IsLargeArc="false" SweepDirection="Clockwise"/></PathFigure></PathGeometry>',
        '<PathGeometry><PathFigure StartPoint="0,0" IsClosed="maybe"/></PathGeometry>',
        '<PathGeometry Transform="0 0 0 0 0 0"/>'
    ]) assert.throws(() => scene(data(geometry)), /dwfx/);
    assert.throws(() => scene(`<Path Data="${rectangle}"><Path.Data><PathGeometry Figures="${rectangle}"/></Path.Data></Path>`), /dwfx/);
    assert.throws(() => scene('<Path><Path.Data/><Path.Data/></Path>'), /dwfx/);
});

test('repeated XPS geometry resource use consumes the shared part budget', () => {
    const body = `<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key">
        <PathGeometry x:Key="shape" Figures="M0 0L10 10"/>
    </ResourceDictionary></FixedPage.Resources><Path Data="{StaticResource shape}"/><Path Data="{StaticResource shape}"/>`;
    assert.throws(() => scene(body, { maxParts: 2 }), /dwfxLimit/);
    assert.equal(scene(body, { maxParts: 3 }).report.parts, 3);
    assert.throws(() => scene(body.replace('Data="{StaticResource shape}"', `Data="${rectangle}" Fill="{StaticResource shape}"`)), /dwfx/);
});

test('XPS geometry transforms change contours before stroking and preserve clip coordinates', async () => {
    const value = scene(`<Canvas><Canvas.Clip><PathGeometry Figures="M0 0H20V20H0Z" Transform="1 0 0 1 10 10"/></Canvas.Clip>
        <Path Stroke="#F00" StrokeThickness="2"><Path.Data><PathGeometry Figures="M0 0L10 0"><PathGeometry.Transform><MatrixTransform Matrix="2 0 0 5 10 20"/></PathGeometry.Transform></PathGeometry></Path.Data></Path>
    </Canvas>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(15, 20), [255, 0, 0, 255]);
    assert.deepEqual(pixel(15, 23), [255, 255, 255, 255]);
    assert.deepEqual(pixel(32, 20), [255, 255, 255, 255]);
});

test('XPS geometry matrix resources preserve sampled elliptical and cubic curves under shear', async () => {
    const { curvePointAt } = await import('./drawingCurveKernel.js');
    const data = 'M5 10 C10 5 15 5 20 10 A10 5 30 0 1 35 15';
    const original = scene(`<Path Data="${data}"/>`).root.children[0].geometry.paths[0].parts;
    const value = scene(`<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key">
        <MatrixTransform x:Key="m" Matrix="2 .2 .5 1 3 4"/>
        <PathGeometry x:Key="g" Figures="${data}" Transform="{StaticResource m}"/>
    </ResourceDictionary></FixedPage.Resources><Path Data="{StaticResource g}"/>`);
    const actual = value.root.children[0].geometry.paths[0].parts;
    for (let i = 0; i < original.length; i++) for (const t of [0, .25, .5, .75, 1]) {
        const p = curvePointAt(original[i], t); const q = curvePointAt(actual[i], t);
        assert.ok(Math.hypot(q.x - (2 * p.x + .5 * p.y + 3), q.y - (.2 * p.x + p.y + 4)) < 1e-7);
    }
});

test('XPS gradient transform properties share typed matrix resource semantics', async () => {
    const make = transform => scene(`<FixedPage.Resources><ResourceDictionary xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key"><MatrixTransform x:Key="shift" Matrix="1 0 0 1 20 0"/></ResourceDictionary></FixedPage.Resources>
        <Path Data="M0 0H60V40H0Z"><Path.Fill><LinearGradientBrush MappingMode="Absolute" StartPoint="0,0" EndPoint="20,0" ${transform === 'resource' ? 'Transform="{StaticResource shift}"' : ''}>
        ${transform === 'property' ? '<LinearGradientBrush.Transform><MatrixTransform Matrix="1 0 0 1 20 0"/></LinearGradientBrush.Transform>' : ''}
        <LinearGradientBrush.GradientStops><GradientStop Color="#F00" Offset="0"/><GradientStop Color="#00F" Offset="1"/></LinearGradientBrush.GradientStops></LinearGradientBrush></Path.Fill></Path>`);
    const property = await pixels(make('property')); const resource = await pixels(make('resource'));
    for (const x of [5, 25, 30, 35, 50]) assert.deepEqual(property(x, 10), resource(x, 10));
    assert.deepEqual(property(5, 10), [255, 0, 0, 255]);
    assert.deepEqual(property(50, 10), [0, 0, 255, 255]);
});

test('unfilled XPS figures retain their stroke without contributing holes or painted interiors', async () => {
    const figures = `<PathFigure StartPoint="5,5" IsClosed="true"><PolyLineSegment Points="35,5 35,35 5,35"/></PathFigure>
        <PathFigure StartPoint="15,15" IsClosed="true" IsFilled="false"><PolyLineSegment Points="25,15 25,25 15,25"/></PathFigure>
        <PathFigure StartPoint="45,5" IsClosed="true" IsFilled="false"><PolyLineSegment Points="65,5 65,25 45,25"/></PathFigure>`;
    const value = scene(`<Path Fill="#F00" Stroke="#00F" StrokeThickness="2" Opacity="0.5"><Path.Data><PathGeometry>${figures}</PathGeometry></Path.Data></Path>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(20, 20), [255, 127, 127, 255]);
    assert.deepEqual(pixel(15, 20), [127, 127, 255, 255]);
    assert.deepEqual(pixel(55, 15), [255, 255, 255, 255]);
    assert.deepEqual(pixel(45, 15), [127, 127, 255, 255]);
});

test('XPS clipping excludes unfilled figures and preserves flags through geometry transforms', async () => {
    const value = scene(`<Canvas><Canvas.Clip><PathGeometry Transform="1 0 0 1 10 10">
        <PathFigure StartPoint="0,0" IsClosed="true"><PolyLineSegment Points="20,0 20,20 0,20"/></PathFigure>
        <PathFigure StartPoint="5,5" IsClosed="true" IsFilled="false"><PolyLineSegment Points="15,5 15,15 5,15"/></PathFigure>
        <PathFigure StartPoint="30,0" IsClosed="true" IsFilled="false"><PolyLineSegment Points="50,0 50,20 30,20"/></PathFigure>
    </PathGeometry></Canvas.Clip><Path Fill="#F00" Data="M0 0H80V60H0Z"/></Canvas>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(20, 20), [255, 0, 0, 255]);
    assert.deepEqual(pixel(50, 20), [255, 255, 255, 255]);
});

test('non-repeating XPS image fills exclude unfilled figures while preserving their outlines', async () => {
    const canvas = createCanvas(1,1); const context = canvas.getContext('2d'); context.fillStyle = '#F00'; context.fillRect(0,0,1,1);
    const xml = `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60"><Path Stroke="#00F" StrokeThickness="2"><Path.Data><PathGeometry>
        <PathFigure StartPoint="5,5" IsClosed="true" IsFilled="false"><PolyLineSegment Points="25,5 25,25 5,25"/></PathFigure>
        <PathFigure StartPoint="35,5" IsClosed="true"><PolyLineSegment Points="55,5 55,25 35,25"/></PathFigure>
    </PathGeometry></Path.Data><Path.Fill><ImageBrush ImageSource="image.png" Viewbox="0,0,1,1" ViewboxUnits="Absolute" Viewport="0,0,80,60" ViewportUnits="Absolute" TileMode="None"/></Path.Fill></Path></FixedPage>`;
    const files = new Map([['page',strToU8(xml)],['image.png',new Uint8Array(canvas.toBuffer('image/png'))]]);
    const pixel = await pixels(readDrawingXpsScene(files,{path:'page'}), true);
    assert.deepEqual(pixel(15,15),[255,255,255,255]);
    assert.deepEqual(pixel(45,15),[255,0,0,255]);
    assert.deepEqual(pixel(5,15),[0,0,255,255]);
});

test('unstroked XPS segments preserve fill and closed joins while omitting only the requested edge', async () => {
    const value = scene(`<Path Fill="#F00" Stroke="#00F" StrokeThickness="4"><Path.Data><PathGeometry><PathFigure StartPoint="10,10" IsClosed="true">
        <PolyLineSegment Points="30,10"/><PolyLineSegment Points="30,30" IsStroked="false"/><PolyLineSegment Points="10,30"/>
    </PathFigure></PathGeometry></Path.Data></Path>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(20,20),[255,0,0,255]);
    assert.deepEqual(pixel(30,20),[255,255,255,255]);
    assert.deepEqual(pixel(10,20),[0,0,255,255]);
    assert.deepEqual(pixel(9,9),[0,0,255,255]);
    const g = value.root.children[0].geometry;
    assert.equal(g.strokePaths.length,1);
    assert.equal(g.strokePaths[0].closed,false);
    assert.equal(g.paths[0].closed,true);
});

test('XPS stroke gaps restart dash phase and retain the endpoint after an omitted curve', async () => {
    const value = scene(`<Path Stroke="#00F" StrokeThickness="2" StrokeDashArray="2 2"><Path.Data><PathGeometry><PathFigure StartPoint="5,10">
        <PolyLineSegment Points="14,10"/><PolyQuadraticBezierSegment Points="20,20 25,10" IsStroked="false"/><PolyLineSegment Points="45,10"/>
    </PathFigure></PathGeometry></Path.Data></Path>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(26,10),[0,0,255,255]);
    assert.deepEqual(pixel(30,10),[255,255,255,255]);
    assert.deepEqual(pixel(19,15),[255,255,255,255]);
    assert.equal(value.root.children[0].geometry.strokePaths.length,2);
    assert.equal(value.root.children[0].geometry.strokePaths[1].parts[0].x1,25);
});

test('closed XPS stroke gaps preserve dash restart at the original start and its join', async () => {
    const value = scene(`<Path Stroke="#00F" StrokeThickness="2" StrokeDashArray="6 2"><Path.Data><PathGeometry><PathFigure StartPoint="10,10" IsClosed="true">
        <PolyLineSegment Points="30,10"/><PolyLineSegment Points="30,20" IsStroked="false"/><PolyLineSegment Points="10,20" IsStroked="false"/>
    </PathFigure></PathGeometry></Path.Data></Path>`);
    const pixel = await pixels(value);
    assert.deepEqual(pixel(9,9),[0,0,255,255]);
    assert.deepEqual(pixel(20,10),[0,0,255,255]);
    assert.deepEqual(pixel(24,10),[255,255,255,255]);
    assert.deepEqual(pixel(27,10),[0,0,255,255]);
    assert.deepEqual(pixel(30,15),[255,255,255,255]);
});

test('closed XPS gaps support zero-length round dashes and suppress flat-cap dots', async () => {
    const make = cap => scene(`<Path Stroke="#00F" StrokeThickness="4" StrokeDashArray="0 2" StrokeStartLineCap="${cap}" StrokeEndLineCap="${cap}" StrokeDashCap="${cap}"><Path.Data><PathGeometry><PathFigure StartPoint="10,10" IsClosed="true">
        <PolyLineSegment Points="34,10"/><PolyLineSegment Points="34,26" IsStroked="false"/><PolyLineSegment Points="10,26" IsStroked="false"/>
    </PathFigure></PathGeometry></Path.Data></Path>`);
    const round = await pixels(make('Round'), true);
    for (const [x,y] of [[10,10],[18,10],[26,10],[10,18]]) assert.deepEqual(round(x,y),[0,0,255,255]);
    assert.deepEqual(round(22,10),[255,255,255,255]);
    const flat = await pixels(make('Flat'), true);
    assert.deepEqual(flat(18,10),[255,255,255,255]);
});
