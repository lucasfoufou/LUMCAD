# 2D tool coverage and LUMCAD roadmap

- Last reviewed: 2026-10-04
- Scope: 2D drafting, annotation, organisation, layouts, output, interoperability, and related productivity tools
- Reference: current working tree

## Purpose

This document tracks LUMCAD's 2D capability coverage and the remaining implementation work. Related commands are grouped when they serve one user goal, such as the **Dimensioning** family.

The inventory focuses on capabilities rather than one-to-one command naming. Related command variants, dialog and command-line forms, palette controls, and supporting configuration flags are folded into their parent capability.

## Status and priority

| Marker | Meaning |
| --- | --- |
| ✅ **Implemented** | The core user-facing workflow is available. |
| 🟡 **Partial** | A usable subset exists; the status cell lists only the remaining gaps. |
| ❌ **Missing** | No first-class user-facing workflow exists. |

| Priority | Meaning |
| --- | --- |
| P0 — Production foundation | Reliable persistence, editing, precision, and output for ordinary 2D plans. |
| P1 — Daily CAD | Frequently used drafting, annotation, layout, and reuse tools. |
| P2 — Advanced productivity | Larger drawings, standards, automation, interoperability, and scheduling. |
| P3 — Specialist / later | Specialised or lower-priority workflows for a later stage. |
| P5 — Optional / ideas | Deferred enhancements and remaining gaps that are not planned for now. |

Priorities reflect LUMCAD's goal: lightweight production of 2D plans, particularly roof, panel-layout, wiring, and grounding drawings.

## P0 — Production foundation

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| Drawing lifecycle and local persistence | `NEW`, `OPEN`, `CLOSE`, `QSAVE`, `SAVE`, `SAVEAS`, automatic save/recovery | ✅ **Implemented** |
| Signed desktop releases and automatic updates | Tagged release builds, signed updater manifest, update check/download/install/restart | ✅ **Implemented**<br>Signed Tauri updater artifacts, architecture-specific GitHub release manifests, startup/six-hour checks, explicit user confirmation, download progress, pre-install drawing flush, and restart. Release publication is gated on complete macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64 assets. |
| DWG and DXF read/write | `OPEN`, `SAVEAS`, `DXFIN`, `DXFOUT`, `IMPORT`, `EXPORT` when used with DWG/DXF | ❌ **Missing**<br>Details : Requires an import/export boundary for layers, entities, appearance, layouts, and units. |
| Line | `LINE` | ✅ **Implemented** |
| Rectangle and regular polygon | `RECTANG`, `POLYGON` | ✅ **Implemented** |
| Circle | `CIRCLE` | ✅ **Implemented** |
| Oversized-circle performance hardening | Circle creation, preview, rendering, snapping, and selection | ✅ **Implemented** |
| Arc | `ARC` | ✅ **Implemented** |
| Selection and preselection | `SELECT`; window, crossing, click, add/remove, Previous/Last/All selection modes | ✅ **Implemented** |
| Grip editing | Drawing grips and multifunction grips | ✅ **Implemented** |
| Erase and history | `ERASE`, `OOPS`, `UNDO`, `U`, `REDO`, `MREDO` | ✅ **Implemented** |
| View navigation | `PAN`, `ZOOM`, Zoom Extents/All/Window/Previous, view history | ✅ **Implemented** |
| Object snaps | `OSNAP`, `-OSNAP`; Endpoint, Midpoint, Center, Geometric Center, Node, Quadrant, Intersection, Extension, Insertion, Perpendicular, Tangent, Nearest, Apparent Intersection, Parallel | ✅ **Implemented** |
| Grid and grid snap | `GRID`, `SNAP`, `DSETTINGS` | ✅ **Implemented** |
| Ortho, polar, and object-snap tracking | `ORTHO`, `POLAR`, `OTRACK`, `DSETTINGS`, temporary override keys | ✅ **Implemented** |
| Coordinate and direct-distance input | Absolute, relative and polar coordinate entry; direct distance entry; `DYNMODE`, `CAL`, `QUICKCALC` | ✅ **Implemented** |
| Layers | `LAYER`, `-LAYER`, `LAYMCUR`, `LAYCUR`, `LAYON`, `LAYOFF`, `LAYFRZ`, `LAYTHW`, `LAYLCK`, `LAYULK`, `LAYDEL`, `RENAME` | ✅ **Implemented** |
| Object properties and ByLayer | `PROPERTIES`, `CHPROP`, `CHANGE`, `COLOR`, `LINETYPE`, `LWEIGHT`, `MATCHPROP` | ✅ **Implemented** |
| Clipboard and copy | `COPY`, `COPYBASE`, `COPYCLIP`, `CUTCLIP`, `PASTECLIP`, `PASTEORIG`, `PASTEBLOCK` | ✅ **Implemented**<br>Versioned lossless JSON-in-SVG clipboard interchange, native macOS SVG/text flavours, bounded external SVG clipboard paste, dependency-aware cross-document remapping, successful-write-only cut, picked-base/original-coordinate paste, and anonymous-block paste. |
| Move | `MOVE` | ✅ **Implemented** |
| Rotate and reference rotation | `ROTATE` with Copy/Reference | ✅ **Implemented** |
| Scale and reference scale | `SCALE` with Copy/Reference | ✅ **Implemented** |
| Align | `ALIGN`, `3DALIGN` used in 2D | ✅ **Implemented**<br>Interactive two- or three-pair best-fit rigid alignment with optional uniform scaling, snapped or typed points, live preview, native entity preservation, and one-step undo/redo. |
| Mirror | `MIRROR`, `MIRRTEXT` | ✅ **Implemented** |
| Offset | `OFFSET` | ✅ **Implemented** |
| Trim and extend | `TRIM`, `EXTEND` | ✅ **Implemented**<br>Exact native-curve trim/extend for lines, arcs, circles, rectangles, polygons, and open/closed mixed paths; straight/freehand fences, finite or virtual edges, explicit 2D projection, curve previews, Shift inversion, and block/hatch cutters. |
| Break, stretch, and lengthen | `BREAK`, `BREAKATPOINT`, `STRETCH`, `LENGTHEN` | ✅ **Implemented**<br>Exact curve/path break and break-at-point; crossing-window vertex/control-point stretch including blocks and hatches; and endpoint lengthen by delta, percent, total, or dynamic value for lines, arcs, ellipses, splines, and open mixed paths. |
| Fillet, chamfer, and blend | `FILLET`, `CHAMFER`, `BLEND` | ✅ **Implemented**<br>Branch-aware tangent fillets with radius-zero cleanup; two-distance or distance-angle chamfers; trim/no-trim, multiple, and whole-path modes; and endpoint-tangent cubic spline blends for open line, arc, spline, and mixed-path branches. |
| Join and explode | `JOIN`, `EXPLODE`, `XPLODE` | ✅ **Implemented**<br>Exact ordered line/arc/ellipse/spline paths with true closure, branch rejection, and safe collinear-line coalescing; exact compound, rounded-rectangle, block, text, hatch, and dimension explode; exploding a QDIM detaches its complete series into independent native dimensions; parent/per-part XPLODE appearance. |
| Dimensioning | `DIM`, `DIMLINEAR`, `DIMALIGNED`, `DIMROTATED`, `DIMANGULAR`, `DIMARC`, `DIMRADIUS`, `DIMDIAMETER`, `DIMJOGGED`, `DIMORDINATE`, `QDIM`, `DIMBASELINE`, `DIMCONTINUE`, `CENTERMARK` | ✅ **Implemented**<br>Associative/free linear, radial, angular, arc-length, ordinate, and centre-mark entities with shared formatting, grips, transforms, clipboard/explode support, and command/MCP creation. QDIM provides editable continuous and baseline series, automatic series-axis inference, a reversible first/last baseline reference, shared visual distance/level-spacing handles, and series detachment into individually editable native dimensions through EXPLODE. |
| Text and multiline notes | `TEXT`, `DTEXT`, `MTEXT`, `MTEDIT`, `TEXTEDIT`, `STYLE` | ✅ **Implemented**<br>Single-line and multiline creation with immediate in-place editing, word/character/no-wrap controls, named styles, fonts, rich runs, alignment, and selection-aware formatting. Deferred text enhancements remain in P5. |
| Layouts and paper setup | `LAYOUT`, `LAYOUTWIZARD`, `PAGESETUP`, `-PAGESETUP`, `PSETUPIN`, `PSETOUT`, `MODEL`, `PSPACE` | ✅ **Implemented**<br>Standard/custom paper, margins, reusable import/export page setups, templates, deterministic duplicate names, scrollable tabs, pointer reordering, multi-selection, and paper-space text/line/rectangle entities. |
| Layout viewports | `MVIEW`, `VPCLIP`, `VPLAYER`, `VPMAX`, `VPMIN`, viewport scale/lock | ✅ **Implemented**<br>Rectangular and clipped transparent viewports with exact scale, rotation, lock, maximize/minimize, display/annotation settings, and per-viewport layer visibility and appearance overrides. |
| PDF plot and multi-layout publish | `PLOT`, `-PLOT`, `EXPORTPDF`, `EXPORT`, `PUBLISH`, `AUTOPUBLISH`, plot preview | ✅ **Implemented**<br>Ordered current/all/selected-sheet publication; exact mixed paper sizes; direct PDF output; vector or bounded-DPI raster PDF; area/layout/window/extents, fit/fixed scale, offsets, margins, colour/lineweight styles, persisted page-setup presets, shared preview/output renderer, sheet-only system-print handoff, atomic native writes, and unattended PDF publication beside a saved `.lcad` file. DWFx output is not considered implemented and is tracked separately in P1. |

## P1 — Daily CAD

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| Associative arrays | `ARRAY`, `ARRAYRECT`, `ARRAYPOLAR`, `ARRAYPATH`, `ARRAYEDIT`, `ARRAYCLOSE` | ✅ **Implemented**<br>Rectangular, polar and connected-path arrays with preview controls, bounded counts/spacing, tangent alignment, signed polar sweeps, editable parameters through ARRAYEDIT/ARRAYCLOSE, source-path association, transforms, archive reload and one-step undo/redo. |
| Construction lines and rays | `XLINE`, `RAY` | ✅ **Implemented**<br>Persistent unbounded entities with two-point creation, viewport-clipped model/layout rendering, origin/direction grips, crossing selection, nearest/intersection snaps, transforms, offset, clipboard, archive reload and undo/redo. |
| Ellipse and elliptical arc | `ELLIPSE` | ✅ **Implemented**<br>Axis/centre construction and elliptical arcs, shared geometry panels, axis/end grips, curve snaps, associative axis and arc-length dimensions, native trim, and normal-distance offsets as bounded cubic paths. Singular inward offsets are rejected. Persistence, clipboard and undo/redo retain native geometry. |
| Spline | `SPLINE`, `SPLINEDIT`, `BLEND` | ✅ **Implemented**<br>FIT/CONTROL construction, persistent point/knot definitions, endpoint tangent constraints, point insertion/removal, exact knot refinement, shared panels/grips, curve snaps, affine transforms, exact Bézier/control conversion, endpoint refitting and tolerance-bounded polyline conversion. Native cubic geometry persists through archives and undo/redo. |
| Hatch, solid fill, and gradient | `HATCH`, `-HATCH`, `HATCHEDIT`, `GRADIENT`, `SOLID`, `HATCHTOBACK` | ✅ **Implemented**<br>Selected contours or interior-point detection, exact native loops, islands, solid/pattern/gradient fills, shared editing, source association, draw order, persistence and undo. Bounded detection rejects ambiguous or excessive arrangements. |
| Boundary and region | `BOUNDARY`, `-BOUNDARY`, `REGION` | ✅ **Implemented**<br>BOUNDARY creates independent closed native polylines from interior picks; REGION creates an independent planar area from selected contours or a picked face with islands. Native paths, transforms, selection, clipboard, explode, persistence and one-step undo are supported. |
| Raster reference images | `IMAGEATTACH`, `IMAGE`, `CLASSICIMAGE`, `IMAGEADJUST`, `IMAGECLIP`, `CLIP`, `TRANSPARENCY` | ✅ **Implemented**<br>Embedded or externally linked images with bounded native attachment, canonical source paths, explicit reload/relink, portable cached snapshots and conversion to embedded mode. Shared source/adjustment/crop panel; brightness, contrast, monochrome, colour key, opacity/transparency, rectangular/polygonal clipping, transformed selection/snapping, clipboard, archive, PDF and undo/redo. Missing sources retain their last snapshot. |
| Basic reusable blocks | `BLOCK`, `-BLOCK`, `INSERT`, `-INSERT`, `CLASSICINSERT`, `BEDIT`, `BSAVE`, `WBLOCK`, `BASE`, `BSEARCH`, block palette | ✅ **Implemented**<br>Named definition creation with picked base point, source conversion/retention, dependency closure, nested references, uniform scale/rotation insertion with preview, explicit redefinition, bounds refresh, searchable block palette, isolated BEDIT/BSAVE/BCLOSE sessions with local history and atomic definition updates, archive/clipboard and undo/redo.<br>Document insertion base point (`BASE`) is available with history and archive persistence.<br>Local `.lcad` library import/export (`WBLOCK`, `BLOCKIMPORT`, `INSERT FILE`) includes nested resources and conflict remapping.<br>Visible nested-child endpoint/midpoint/nearest/intersection snaps and exact nonuniform circle/arc decomposition are supported.<br>Nested layer-0 inheritance is shared by rendering, snaps, clipboard SVG and appearance-preserving EXPLODE.<br>General affine image/text decomposition retains editable local content, crop, world-space grips, subsequent transforms, archive/clipboard and shared model/print rendering. |
| Block attributes | `ATTDEF`, `ATTEDIT`, `ATTSYNC`, `BATTMAN`, `ATTDISP`, `ATTEXT` | ✅ **Implemented**<br>Native text definitions, per-insertion values, constant/invisible fields, command and selection-panel editing, synchronization preserving values by tag, visibility modes, nested rendering/snapping, clipboard/archive and undo/redo.<br>Attribute manager provides tag/value migration, prompts/defaults, constant/invisible flags, ordering and dependency-safe removal through the palette and BATTMAN.<br>ATTEXT exports all/selected model occurrences, including nested values and world coordinates, as CSV or lossless JSON through atomic native output or browser download.<br>Definition creation form and pre-insertion value fields share the existing palette; interactive INSERT accepts ATTRIBUTE values and commits them with geometry.<br>Per-instance and nested bounds account for long values; single-line rendering remains unclipped in model/print output. Native/UI checks cover editing, insertion, extraction and undo. |
| Dimension styles and dimension maintenance | `DIMSTYLE`, `DIMEDIT`, `DIMTEDIT`, `DIMUPDATE`, `DIMREASSOCIATE`, `DIMDISASSOCIATE`, `DIMBREAK`, `DIMSPACE`, `DIMINSPECT`, `DIMREGEN` | ✅ **Implemented**<br>• Named style catalog, bounded normalization, override-preserving updates, archive persistence, collision-safe clipboard/block-library style transfer, DIMSTYLE commands and current-style assignment at creation; dedicated style panel with rename/apply/current controls and property overrides; DIMSTYLE SET and shared panel/property controls cover tolerance, alternate-unit and inspection fields; style edits refresh cached nested block/insertion bounds; creation preview integration<br>• Shared arrow, text and extension-line presentation in model/print/SVG; styled arrows and extension-line selection/bounds<br>• Property overrides, DIMUPDATE, DIMREGEN and DIMINSPECT; DIMEDIT manual/dynamic label editing and property field; DIMTEDIT POSITION/ANGLE/HOME and property controls for independent label placement; DIMEDIT OBLIQUE/ROTATE supports extension-line direction and label rotation; DIMTEDIT also offers snapped interactive placement with live preview, coordinate entry and cancellation<br>• DIMDISASSOCIATE preserves native points/local curve snapshots; DIMREASSOCIATE validates explicit source IDs or interactive source picks, including two-line angular references and cancellation. Detached radial/centre sources follow nonuniform affine transforms as exact ellipse snapshots; radial values measure the transformed central ray.<br>• DIMSPACE explicit/automatic spacing and zero alignment of parallel linear or concentric angular dimensions, with base selection and atomic validation; POINT spacing picks support perpendicular/radial gap measurement, snapping, live preview, coordinate/numeric/AUTO input, cancellation and one-step undo; DIMBREAK manual two-coordinate gaps and REMOVE share model/print/SVG presentation for lines/arcs. Interactive break picks support snapping, live preview, coordinates and cancellation; DIMBREAK AUTO derives live intersection gaps from supported native curves with bounded computation; dimension obstacles include styled lines/arcs and manual gaps without recursive automatic gaps; block obstacles use bounded nested materialization with transformed curves and local dimension references; bounded traversal includes empty nested branches; selected-dimension properties report suspended automatic gaps after complex edits and provide gap-width/disable controls |
| Leaders and multileaders | `LEADER`, `QLEADER`, `MLEADER`, `MLEADEREDIT`, `MLEADERALIGN`, `MLEADERCOLLECT`, `MLEADERSTYLE` | ❌ **Missing**<br>Details : Standalone leaders, multiple leaders, block content, alignment/collection, landings, and styles. |
| Annotation scaling | `OBJECTSCALE`, `SCALELISTEDIT`, `ANNOUPDATE`, `ANNORESET`; annotative text/dimensions/leaders/hatches/blocks | 🟡 **Partial**<br>• General annotative-object model<br>• Multiple scale representations<br>• Annotation-scale visibility<br>• Object-scale list<br>• Synchronisation |
| Model-equivalent paper-annotation workflow | `TEXT`, `MTEXT`, `LINE`, `RECTANG`, `OSNAP`, command bar in paper space | 🟡 **Partial**<br>• Command-bar creation in paper space<br>• Shared model quick editor for paper text<br>• Object snaps, tracking, and magnetism<br>• The same select, move, and contextual-edit experience in layouts as in model space |
| Homogeneous creation and property editing | `PROPERTIES`, creation/edit panels, contextual options, dynamic input | 🟡 **Partial**<br>• One primary reusable creation/edit-panel workflow across tools<br>• At most two predictable interaction patterns for every entity type<br>• Remove tool-specific splits between command-bar options, the right property bar, and separate creation/edit panels<br>• A consistent pre-creation, post-creation, selection, commit, and cancellation lifecycle |
| Centre marks and centre lines | `CENTERMARK`, `CENTERLINE`, `CENTERREASSOCIATE`, `CENTERDISASSOCIATE`, `CENTERRESET` | ✅ **Implemented**<br>• CENTERLINE creates associative midlines/bisectors from two selected or picked segments, with alternate bisector, editable extension and extension grip; source edits, snapshots, reset and reassociation supported<br>• CENTERREASSOCIATE supports explicit or interactive circle/arc sources for marks and paired line sources for centre lines; CENTERDISASSOCIATE retains native snapshots<br>• CENTERRESET restores default size/extension and current dimension-style appearance; atomic edits and undo |
| Draw order and masks | `DRAWORDER`, `TEXTTOFRONT`, `HATCHTOBACK`, `WIPEOUT` | ✅ **Implemented**<br>Stable front/back, one-level and above/below-reference ordering; text/dimension front ordering; hatch back ordering; persistent polygonal WIPEOUT masks with interactive preview, frame controls, transforms, grips, clipboard, printing and undo. |
| Groups | `GROUP`, `-GROUP`, `GROUPEDIT`, `UNGROUP`, `CLASSICGROUP` | ❌ **Missing**<br>Details : Named non-destructive group selection. |
| Hide and isolate objects | `HIDEOBJECTS`, `ISOLATEOBJECTS`, `UNISOLATEOBJECTS` | 🟡 **Partial**<br>• Arbitrary temporary object isolation |
| Advanced selection and counting | `QSELECT`, `FILTER`, `SELECTSIMILAR`, `SELECTCOUNT`, `COUNT`, `COUNTAREA`, `BCOUNT` | ❌ **Missing**<br>Details : Selection by type/layer/property, filters, similar-object selection, counts/highlight, and count tables. |
| Match and move properties/layers | `MATCHPROP`, `LAYMCH`, `LAYMCUR`, `COPYTOLAYER` | 🟡 **Partial**<br>• Source-object Match Properties<br>• Make-current-from-object<br>• Copy-to-layer command |
| Named views | `VIEW`, `-VIEW`, `VIEWGO`, `VIEWPLOTDETAILS` | ❌ **Missing**<br>Details : Named model views with save, restore, import, and management. |
| Units, precision, and 2D UCS | `UNITS`, `-UNITS`, `UCS`, `UCSMAN`, `UCSICON`, `LIMITS` | 🟡 **Partial**<br>• Display precision<br>• Angle format and direction<br>• Alternate units<br>• Insertion units<br>• Custom 2D origin and rotation<br>• Named UCS<br>• UCS icon<br>• Drawing limits |
| Measurement and inquiry | `MEASUREGEOM`, `DIST`, `AREA`, `ID`, `LIST`, `STATUS`, `MASSPROP` for 2D regions | 🟡 **Partial**<br>• Non-persistent distance, angle, area, perimeter, and radius inquiry<br>• Coordinate ID<br>• Entity listing<br>• Cumulative area<br>• Copy-result workflow |
| Advanced layer management | `LAYERSTATE`, `LAYERSTATESAVE`, `LAYISO`, `LAYUNISO`, `LAYWALK`, `LAYMRG`, `LAYTRANS`, filters, viewport overrides | 🟡 **Partial**<br>• Layer states<br>• Isolation and walk<br>• Merge<br>• Translation and mapping<br>• Filters<br>• Freeze and new-VP-freeze<br>• Plot/no-plot state |
| External drawing references | `XREF`, `-XREF`, `XATTACH`, `ATTACH`, `EXTERNALREFERENCES`, `XBIND`, `REFEDIT`, `XCLIP`, `XCOMPARE` | ❌ **Missing**<br>Details : Live references with path/reload, overlay/nest, clip, bind, edit-in-place, and compare workflows. |
| PDF underlay and vector PDF import | `PDFATTACH`, `PDFCLIP`, `PDFLAYERS`, `PDFIMPORT`, `PDFSHXTEXT`, underlay snaps | ❌ **Missing**<br>Details : PDF page attachment, layer control, vector snaps/extraction, clipping, and SHX text conversion. |
| Plot styles and page-setup profiles | `STYLESMANAGER`, `PLOTSTYLE`, `CONVERTCTB`, `CONVERTPSTYLES`, `PAGESETUP`, `PSETUPIN` | 🟡 **Partial**<br>• Named/colour-dependent plot styles and CTB/STB-like mapping<br>• Plot-device profiles<br>• Plot stamps |
| Autodesk-compatible DWFx publishing | `DWFXOUT`, `EXPORT`, `PUBLISH` | ❌ **Missing**<br>Details : Generated DWFx files are still rejected by Autodesk Viewer/A360 with `TranslationWorker-InternalFailure Extractor error code -1 A360.Extractor.DWF2D.InternalError Internal error processing 2d DWF section`. Fix and validate the complete 2D ePlot/DWFx representation against Autodesk's cloud extractor before marking this capability implemented. |
| Model/paper transfer and viewport alignment | `CHSPACE`, `ALIGNSPACE`, `EXPORTLAYOUT` | ❌ **Missing**<br>Details : Model/paper transfer, paired-point viewport alignment, and layout-to-model export. |

## P2 — Advanced productivity

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| Point, divide, and measure placement | `POINT`, `DDPTYPE`, `DIVIDE`, `MEASURE` | ❌ **Missing**<br>Details : Persistent point entities, point styles, equal/fixed intervals, and block placement along an object. |
| Multiline, donut, and wide linework | `MLINE`, `MLEDIT`, `MLSTYLE`, `DONUT`, polyline width | ❌ **Missing**<br>Details : Multiline, donut, and variable-width linework. |
| Freehand sketch | `SKETCH` | ❌ **Missing**<br>Details : Sampled freehand line/polyline creation with record increment. |
| Revision clouds and break symbols | `REVCLOUD`, `REVCLOUDPROPERTIES`, `BREAKLINE` | ❌ **Missing**<br>Details : Revision-cloud entity/conversion and architectural breakline symbol. |
| Tables and table styles | `TABLE`, `-TABLE`, `TABLEDIT`, `TABLESTYLE`, `TABLEEXPORT` | ❌ **Missing**<br>Details : Cell grid, merged cells, formulas, formatting, styles, CSV/data links, and schedules. |
| Fields and linked values | `FIELD`, `UPDATEFIELD`, `DATALINK`, `DATALINKUPDATE` | ❌ **Missing**<br>Details : Links to metadata, object properties, dates, formulas, spreadsheets, and page numbers. |
| Geometric tolerances | `TOLERANCE` | ❌ **Missing**<br>Details : Feature-control frames, datums, material conditions, projection zones, and tolerance styles. |
| Dynamic and smart blocks | `BEDIT` plus `BPARAMETER`, `BACTION`, `BLOOKUPTABLE`, `BTABLE`, visibility states, `RESETBLOCK`, smart-block detection/replacement | ❌ **Missing**<br>Details : Depends on basic block definitions and references. |
| Geometric constraints | `GEOMCONSTRAINT`, `AUTOCONSTRAIN`, `GCCOINCIDENT`, `GCCOLLINEAR`, `GCCONCENTRIC`, `GCEQUAL`, `GCFIX`, `GCHORIZONTAL`, `GCPARALLEL`, `GCPERPENDICULAR`, `GCSYMMETRIC`, `GCTANGENT`, `GCVERTICAL`, `GCSMOOTH` | ❌ **Missing**<br>Details : Persistent parametric relationships and a constraint solver. |
| Dimensional constraints and parameters | `DIMCONSTRAINT`, `DCLINEAR`, `DCALIGNED`, `DCANGULAR`, `DCRADIUS`, `DCDIAMETER`, `DCCONVERT`, `PARAMETERS` | ❌ **Missing**<br>Details : Driving dimensions, expressions, user variables, formula graph, and solver. |
| Edit-specific object tools | `PEDIT`, `SPLINEDIT`, `HATCHEDIT`, `MLEDIT`, `TEXTEDIT`, `TABLEDIT`, `ARRAYEDIT`, `REFEDIT` | 🟡 **Partial**<br>• Consistent post-creation contextual editors for richer entity types |
| Cleanup and duplicate removal | `OVERKILL`, `FLATTEN`, `PURGE`, `-PURGE` | ❌ **Missing**<br>Details : Duplicate/overlap removal, collinear merge, zero-length cleanup, flattening, unused-definition purge, and cleanup report. |
| Drawing validation and recovery | `AUDIT`, `RECOVER`, `RECOVERALL`, Drawing Recovery Manager | 🟡 **Partial**<br>• Geometry integrity audit and repair<br>• Partial salvage<br>• Corrupt archive recovery<br>• Dependency recovery |
| Templates and reusable drawing content | `NEW`, `QNEW`, `DWT`, `WBLOCK`, DesignCenter (`ADCENTER`), tool palettes | ❌ **Missing**<br>Details : `.lcad` templates, content library, symbol palette, content browser, and selected-content export. |
| Data extraction and schedules | `DATAEXTRACTION`, `EATTEXT`, `ATTEXT`, `COUNTLIST`, `COUNTTABLE` | ❌ **Missing**<br>Details : Object metadata schema, aggregation, table insertion, CSV/XLS export, and scheduled quantity extraction. |
| Drawing comparison and standards | `COMPARE`, `COMPAREIMPORT`, `XCOMPARE`, `CHECKSTANDARDS`, `STANDARDS`, `LAYTRANS` | ❌ **Missing**<br>Details : Visual/document diff, accepted-change import, revision-cloud generation, standards files, and standards repair. |
| Sheet sets and multi-drawing publishing | `SHEETSET`, `NEWSHEETSET`, `OPENSHEETSET`, `PUBLISH`, `ARCHIVE`, `ETRANSMIT` | 🟡 **Partial**<br>• Project-wide multi-drawing sets<br>• Sheet numbering and index<br>• Batch metadata<br>• Transmittal<br>• Archive dependency packaging |
| Legacy DWF6, DGN, and other 2D underlays/interchange | `DWFATTACH`, `DWFCLIP`, `DGNATTACH`, `DGNCLIP`, `DGNIMPORT`, `DGNEXPORT`, `WMFIN`, `WMFOUT` | ❌ **Missing**<br>Details : Legacy W2D/DWF6 output, DWF/DWFx underlays/import, DGN, and WMF import/export. Autodesk-compatible XPS/ePlot DWFx publishing is tracked as missing in P1. |
| Raster and vector image export | `PNGOUT`, `JPGOUT`, `TIFOUT`, `BMPOUT`, `WMFOUT`, `EXPORT` | ❌ **Missing**<br>Details : PNG, JPEG, TIFF, BMP, SVG, and WMF export with resolution and background options. |
| Clipping of references and viewports | `CLIP`, `XCLIP`, `IMAGECLIP`, `PDFCLIP`, `DWFCLIP`, `DGNCLIP`, `VPCLIP` | 🟡 **Partial**<br>• Reference and underlay clip paths<br>• Inverted clip paths |
| Object links and OLE | `HYPERLINK`, `ATTACHURL`, `OLELINKS`, `PASTESPEC`, `INSERTOBJ` | ❌ **Missing**<br>Details : Clickable object metadata, embedded/linked office objects, and special paste. |
| Command aliases and custom shortcuts | `ALIASEDIT`, PGP aliases, `CUI`, `CUIIMPORT`, `CUIEXPORT`, `QUICKCUI` | 🟡 **Partial**<br>• User-defined aliases<br>• Rebindable shortcuts<br>• Toolbar layouts<br>• Workspaces |
| Scripts, macros, and application API | `SCRIPT`, `SCRIPTCALL`, Action Recorder commands, command macros, AutoLISP (`VLISP`/`LOAD`), VBA/.NET/ObjectARX loading | 🟡 **Partial**<br>• Script-file language<br>• Action recorder<br>• Macro editor<br>• Plugin SDK<br>• Sandboxed extensions<br>• LISP compatibility |
| Object and block counting | `COUNT`, `COUNTAREA`, `COUNTLIST`, `COUNTTABLE`, `BCOUNT` | ❌ **Missing**<br>Details : Spatial counts, similar-object detection, error checking, navigation, and inserted count fields/tables. |

## P3 — Specialist / later

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| 2D isometric drafting | `ISODRAFT`, `ISOPLANE`, isometric grid/snap, isocircle option | ❌ **Missing**<br>Details : Isometric grid/snap and isocircle drafting. |
| Shape and SHX resources | `LOAD`, `SHAPE`, `COMPILE`; SHX text handling | ❌ **Missing**<br>Details : Custom shape definition/insertion and SHX font/shape compiler. |
| Arc-aligned text | `ARCTEXT` | ❌ **Missing**<br>Details : Arc-aligned text layout depends on arc geometry. |
| Geographic location and online maps | `GEOGRAPHICLOCATION`, `GEOLOCATEME`, `GEOMAP`, `GEOMAPIMAGE`, coordinate-system tools | ❌ **Missing**<br>Details : Georeferencing, map tiles, north/geodetic transform, and map capture. |
| Markup, Trace, and review collaboration | `TRACE`, `TRACEBACK`, `TRACEFRONT`, `MARKUPIMPORT`, `MARKUPASSIST`, `SHARE`, review links | ❌ **Missing**<br>Details : Revision overlays, markup recognition, review sessions, approvals, and share links. |
| Digital signatures | `DIGITALSIGN`, signature validation | ❌ **Missing**<br>Details : Signing and verification for `.lcad` archives and exported PDFs. |
| Drawing packaging and transmittals | `ETRANSMIT`, `ARCHIVE`, `REFERENCE MANAGER` | 🟡 **Partial**<br>• Dependency manifest UI<br>• External-reference packaging<br>• Transmittal report<br>• Password/encryption option<br>• Archive command |
| Cloud drawing storage and activity history | Web/mobile open/save, cloud document integration, Activity Insights | ❌ **Missing**<br>Details : Optional remote sync/provider integration and activity history. |
| Partial open and demand loading | `PARTIALOPEN`, `PARTIALLOAD`, spatial/layer indexes | ❌ **Missing**<br>Details : Partial loading and spatial/layer indexes for large drawings. |
| UI/workspace administration | `CLEANSCREENON/OFF`, `RIBBON`, `TOOLBAR`, `WORKSPACE`, `OPTIONS`, `PROFILE`, `CUI` | 🟡 **Partial**<br>• Named workspaces<br>• User profiles<br>• Dockable palette system<br>• Toolbar customisation<br>• Clean-screen mode |

## P5 — Optional / ideas

These remaining gaps are intentionally deferred and do not block the core workflows already available.

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| Deferred text enhancements | `TXT2MTXT`, `FIND`, `SPELL`, text import, annotative text | 🟡 **Partial**<br>• Tabs, lists, and stacked fractions<br>• Annotative text<br>• Find/Replace<br>• Spellcheck<br>• Text import<br>• Text-to-MText conversion |
| Remaining polyline creation and editing | `PLINE`, `PEDIT`, `CONVERTPOLY`, `REVERSE` | 🟡 **Partial**<br>• First-class `PLINE` drawing<br>• Line/arc segment switching<br>• Width and taper<br>• Close/open workflow<br>• Fit and spline modes<br>• Add/remove vertex<br>• Reverse workflow |
| Remaining grip types | Drawing grips and multifunction grips | 🟡 **Partial**<br>• Circle quadrant grips<br>• Hatch grips<br>• Block grips<br>• Leader grips<br>• Multifunction grips |
| Remaining selection modes | `SELECT`; window, crossing, click, add/remove, Previous/Last/All selection modes | 🟡 **Partial**<br>• Fence selection<br>• Crossing-polygon and window-polygon selection<br>• Lasso/freehand selection<br>• Previous, Last, and All modes<br>• Nested selection<br>• Selection cycling<br>• Saved selection sets |
| Remaining zoom variants and history | `PAN`, `ZOOM`, Zoom Extents/All/Window/Previous, view history | 🟡 **Partial**<br>• Zoom Window<br>• Zoom Previous<br>• Saved view history<br>• Typed zoom suffixes (`X`, `XP`) |
| Remaining object snaps | `OSNAP`, `-OSNAP`; Endpoint, Midpoint, Center, Geometric Center, Node, Quadrant, Intersection, Extension, Insertion, Perpendicular, Tangent, Nearest, Apparent Intersection, Parallel | 🟡 **Partial**<br>• Geometric centre<br>• Node<br>• Quadrant<br>• Extension<br>• Insertion<br>• Perpendicular<br>• True tangent construction<br>• Apparent intersection<br>• Parallel<br>• One-shot overrides<br>• Tab cycling<br>Details : `Nearest` is not a mathematical tangent snap. |
| Remaining grid-snap features | `GRID`, `SNAP`, `DSETTINGS` | 🟡 **Partial**<br>• Independent X/Y spacing<br>• Rotated/isometric grids<br>• Major-line configuration<br>• Full drafting-settings view |
| Remaining layer features | `LAYER`, `-LAYER`, `LAYMCUR`, `LAYCUR`, `LAYON`, `LAYOFF`, `LAYFRZ`, `LAYTHW`, `LAYLCK`, `LAYULK`, `LAYDEL`, `RENAME` | 🟡 **Partial**<br>• Freeze/thaw distinct from on/off<br>• Plot/no-plot<br>• Descriptions<br>• Reconciliation<br>• Bulk actions<br>• Command aliases |
| Remaining object-property features | `PROPERTIES`, `CHPROP`, `CHANGE`, `COLOR`, `LINETYPE`, `LWEIGHT`, `MATCHPROP` | 🟡 **Partial**<br>• Geometry coordinates in the property panel<br>• Plot style<br>• Linetype scale<br>• Line joins/caps<br>• Thickness<br>• Hyperlinks<br>• Match Properties<br>• Property filters |

## Recommended implementation order

The roadmap is best approached in this order:

1. Finish first-class polyline creation and editing on the existing exact curve/path kernel.
2. Add DWG/DXF import/export behind a tested conversion boundary that preserves layers, entity appearance, blocks, dimensions, layouts, and units where supported.
3. Extend precision drafting with one-shot snap overrides, display/angle precision controls, coordinate inquiry, and a configurable 2D UCS.
4. Add user-facing hatch/region and reusable-block creation and editing, leaders, dimension styles, and annotation scaling.
5. Extend deterministic PDF generation with preview, plot styles, and direct file output.
6. Add references/PDF underlays, tables/fields, constraints, cleanup, content libraries, and project-wide sheet workflows.

The first two items should be designed together so the geometry model and interchange boundary can evolve consistently.

## Recent progress

- 2026-10-04: Rectangular arrays now open directly in an editable preview with motif-sized spacing and remembered row/column counts (2 × 2 initially). Origin, spacing, and counts can be adjusted with canvas handles or command options before a single undoable commit; cancellation leaves the drawing unchanged. Polar/path arrays remain open.

- 2026-10-04: `ARRAYEDIT` reopens rectangular array parameters, preserving identity and appearance, with `ARRAYCLOSE`/Enter to commit. Displacement vectors follow rotation, scale and mirror; native/browser archive round trips preserve editing data.

- 2026-10-04: `ARRAYPOLAR` supports center selection, count, signed sweep, fixed/rotating motif orientation, preview grips, `ARRAYEDIT`, transforms and archive reload. Path arrays remain open.

- 2026-10-04: `ARRAYPATH` adds length-based divide/measure placement, start offset, reversed traversal, tangent alignment and live path associations within the same history commit. All three array families share parameter editing, cancellation and explicit explode-to-independent-geometry workflows.

- 2026-10-04: `XLINE` and `RAY` create native unbounded entities. Rendering clips to the current viewport (including rotated layouts); snapping and crossing selection use mathematical geometry rather than artificial long segments. Direction points remain editing handles, not endpoints.

- 2026-10-04: `ELLIPSE` adds axis-endpoint/centre construction and five-point elliptical arcs with CW/CCW direction. The shared panel edits centre, axes, rotation and parameter angles; grips edit both full and partial ellipses. Offset and ellipse-specific dimensions remain open.

- 2026-10-04: Ellipse axes now support associative `DIM`, `DIMALIGNED`, `DIMLINEAR` and `DIMROTATED` measurements, including both axes by pick, source edits, archive reload and clipboard remapping. Affine transformations retain axis order when radii cross. Ellipse offset and elliptical arc-length dimensions remain open.

- 2026-10-04: `DIMARC` now measures elliptical arcs through adaptive source-curve integration, with associative updates, normal-offset annotation grips, shared output rendering, archive and clipboard coverage. Ellipse offset remains open.

- 2026-10-04: Ellipse `OFFSET` now supports distance/side and through-point modes, with tangent-continuous cubic-path output at 0.01 mm target tolerance. Full results close exactly; arcs preserve their domain. Singular and work-limit failures leave the document unchanged. Ellipse workflows are complete.

- 2026-10-04: `SPLINE` adds natural chord-length fit-point interpolation and clamped uniform cubic B-spline construction through CONTROL/CV, with live previews, Enter/DONE completion, a 128-point bound and one-step undo. Exact native Bézier spans retain existing curve snaps, rendering and archive support. Single-span coordinates are editable in the shared panel; compound spans retain their existing independent grips. Dedicated fit/knot definitions and continuity-preserving editing remain open.

- 2026-10-04: `SPLINEDIT` opens the shared cubic-control editor for single or multiple spans, with a span selector and MCP/command input `CONTROL span control x y`. Joint grips move both connected endpoints and adjacent controls; tangent edits retain existing smooth tangent ratios while preserving intentional corners. Closed seams stay closed, duplicate joint grips are hidden, and invalid edits are rejected atomically. Fit-definition, knot and conversion workflows remain open.

- 2026-10-04: Splines now retain bounded editable FIT/CONTROL definitions, normalized parameters/knots, and definition-point grips. SPLINEDIT and the shared panel edit points and knots; affine transforms retain parameters and transform the exact curve. BEZIER conversion is exact and undoable. Native/browser archives retain definitions; stale metadata detaches after direct geometry edits. Explicit endpoint tangent constraints and further editing/conversion workflows remain open.

- 2026-10-04: Endpoint tangents are now editable through SPLINEDIT and the shared panel. FIT persists start/end derivative constraints with natural reset, while CONTROL adjusts its endpoint handle using the knot interval. Mixed natural/clamped interpolation, archive reload, affine vector transforms and invalid-input rejection are covered.

- 2026-10-04: SPLINEDIT and the shared panel now add/remove definition points, refine CONTROL knots exactly, convert native cubic spans to control definitions, refit endpoints or point polylines, and flatten to straight segments with an explicit tolerance and bounded work. Native/browser checks cover identity, geometry, archive reload, history and invalid inputs. Spline workflows are complete.

- 2026-10-04: HATCH/SOLID/GRADIENT create associative native-loop fills from selected closed contours or connected chains. Shared editing supports solid, parallel/cross patterns, linear/radial gradients, origin, spacing and detach; even-odd loops preserve islands. Source edits refresh in one history step, independent moves detach, and HATCHTOBACK reorders fills. Archives, clipboard paints/dependencies, undo and native command workflows are covered. Interior-point boundary detection remains open.

## Maintenance rule

Update this file whenever a command is added to `src/mcp/commands.json`, a new entity becomes user-creatable, or a listed subset changes materially. Use **Implemented** only for a complete user workflow covering persistence, rendering, selection/editing, undo/redo, layout rendering, and relevant tests.

- 2026-10-04: HATCH PICK adds bounded native-curve face detection from a click or typed point, including crossing dividers and immediate islands. Pick seeds persist and follow shared affine transforms; invalid seeds detach the last snapshot.

- 2026-10-04: REGION adds independent native-loop planar areas from selected closed contours or interior picks, with even-odd islands, a whole-object movement grip, transforms, clipboard, explode and archive persistence. BOUNDARY creates separate closed paths from the same detector.

- 2026-10-04: IMAGEADJUST adds nondestructive brightness, contrast and monochrome controls in the shared editor and command/MCP entry point, preserving source bytes through persistence and applying matching SVG/PDF image transfers.

- 2026-10-04: IMAGECLIP adds persistent rectangular/polygonal crop contours, shared percentage controls, ON/OFF/DELETE, clipped selection/snapping and exact SVG clip paths for model/layout/print and clipboard output.

- 2026-10-04: DRAWORDER and TEXTTOFRONT add stable painter-order editing with locked-object protection. WIPEOUT adds native polygon masks with selected-contour or interactive creation, frame control, shared editing, persistence and undo.

- 2026-10-04: Image colour-key transparency adds exact/tolerant RGB matching in the shared editor and IMAGEADJUST KEY, consistent SVG membership filters and original-pixel PDF baking with alpha preservation.
