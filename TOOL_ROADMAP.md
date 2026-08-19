# 2D tool coverage and LUMCAD roadmap

- Last reviewed: 2026-08-19
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
| PDF plot and multi-layout publish | `PLOT`, `-PLOT`, `EXPORTPDF`, `EXPORT`, `PUBLISH`, `AUTOPUBLISH`, plot preview | 🟡 **Partial**<br>• Direct deterministic PDF-file export<br>• Plot preview<br>• Plot area, window, and extents choices<br>• Scale-to-fit<br>• Margins<br>• Print styles<br>• Raster/vector quality controls<br>• Presets and named page setups<br>• Mixed-paper-size multi-layout native print jobs<br>• DWF/DWFx<br>• Unattended publish |

## P1 — Daily CAD

| Capability | Grouped command references | LUMCAD status |
| --- | --- | --- |
| Associative arrays | `ARRAY`, `ARRAYRECT`, `ARRAYPOLAR`, `ARRAYPATH`, `ARRAYEDIT`, `ARRAYCLOSE` | 🟡 **Partial**<br>• Polar arrays<br>• Path arrays<br>• Post-creation associative editing<br>• Start rectangular arrays immediately with default spacing and quantities instead of staged distance/count prompts<br>• Adjust those defaults visually before finalising the array |
| Construction lines and rays | `XLINE`, `RAY` | ❌ **Missing**<br>Details : Persistent XLINE and RAY entities. |
| Ellipse and elliptical arc | `ELLIPSE` | ❌ **Missing**<br>Details : Ellipse and elliptical-arc entities, construction modes, grips, snaps, offset, trim, and dimensions. |
| Spline | `SPLINE`, `SPLINEDIT`, `BLEND` | ❌ **Missing**<br>Details : Fit-point/control-vertex splines, tangent/knot editing, conversion, and snapping. |
| Hatch, solid fill, and gradient | `HATCH`, `-HATCH`, `HATCHEDIT`, `GRADIENT`, `SOLID`, `HATCHTOBACK` | ❌ **Missing**<br>Details : Boundary detection, associative patterns, solid/gradient fills, island handling, origin, and editing. |
| Boundary and region | `BOUNDARY`, `-BOUNDARY`, `REGION` | ❌ **Missing**<br>Details : Closed-polyline and region creation from enclosed areas. |
| Raster reference images | `IMAGEATTACH`, `IMAGE`, `CLASSICIMAGE`, `IMAGEADJUST`, `IMAGECLIP`, `CLIP`, `TRANSPARENCY` | 🟡 **Partial**<br>• Brightness, contrast, and monochrome controls<br>• Crop/clip boundary<br>• Path/reload management<br>• Draw-order control<br>• Transparency colour<br>• External-link mode |
| Basic reusable blocks | `BLOCK`, `-BLOCK`, `INSERT`, `-INSERT`, `CLASSICINSERT`, `BEDIT`, `BSAVE`, `WBLOCK`, `BASE`, `BSEARCH`, block palette | ❌ **Missing**<br>Details : Block definitions/references, insertion point, scale, rotation, redefinition, editor, libraries, and write-block. |
| Block attributes | `ATTDEF`, `ATTEDIT`, `ATTSYNC`, `BATTMAN`, `ATTDISP`, `ATTEXT` | ❌ **Missing**<br>Details : Attribute definition, editing, synchronization, display, and extraction. |
| Dimension styles and dimension maintenance | `DIMSTYLE`, `DIMEDIT`, `DIMTEDIT`, `DIMUPDATE`, `DIMREASSOCIATE`, `DIMDISASSOCIATE`, `DIMBREAK`, `DIMSPACE`, `DIMINSPECT`, `DIMREGEN` | 🟡 **Partial**<br>• Named dimension styles<br>• Arrow, text, and extension-line settings<br>• Style overrides and update workflows<br>• Reassociation/disassociation<br>• Dimension break and spacing |
| Leaders and multileaders | `LEADER`, `QLEADER`, `MLEADER`, `MLEADEREDIT`, `MLEADERALIGN`, `MLEADERCOLLECT`, `MLEADERSTYLE` | ❌ **Missing**<br>Details : Standalone leaders, multiple leaders, block content, alignment/collection, landings, and styles. |
| Annotation scaling | `OBJECTSCALE`, `SCALELISTEDIT`, `ANNOUPDATE`, `ANNORESET`; annotative text/dimensions/leaders/hatches/blocks | 🟡 **Partial**<br>• General annotative-object model<br>• Multiple scale representations<br>• Annotation-scale visibility<br>• Object-scale list<br>• Synchronisation |
| Model-equivalent paper-annotation workflow | `TEXT`, `MTEXT`, `LINE`, `RECTANG`, `OSNAP`, command bar in paper space | 🟡 **Partial**<br>• Command-bar creation in paper space<br>• Shared model quick editor for paper text<br>• Object snaps, tracking, and magnetism<br>• The same select, move, and contextual-edit experience in layouts as in model space |
| Homogeneous creation and property editing | `PROPERTIES`, creation/edit panels, contextual options, dynamic input | 🟡 **Partial**<br>• One primary reusable creation/edit-panel workflow across tools<br>• At most two predictable interaction patterns for every entity type<br>• Remove tool-specific splits between command-bar options, the right property bar, and separate creation/edit panels<br>• A consistent pre-creation, post-creation, selection, commit, and cancellation lifecycle |
| Centre marks and centre lines | `CENTERMARK`, `CENTERLINE`, `CENTERREASSOCIATE`, `CENTERDISASSOCIATE`, `CENTERRESET` | 🟡 **Partial**<br>• Centreline annotations<br>• Explicit reassociation/disassociation<br>• Reset-to-style workflow |
| Draw order and masks | `DRAWORDER`, `TEXTTOFRONT`, `HATCHTOBACK`, `WIPEOUT` | ❌ **Missing**<br>Details : Send forward/back, masking regions, and text/dimension front ordering. |
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
| DWF/DGN and other 2D underlays/interchange | `DWFATTACH`, `DWFCLIP`, `DGNATTACH`, `DGNCLIP`, `DGNIMPORT`, `DGNEXPORT`, `WMFIN`, `WMFOUT` | ❌ **Missing**<br>Details : DWF/DWFx, DGN, and WMF import/export and underlays. |
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

## Maintenance rule

Update this file whenever a command is added to `src/mcp/commands.json`, a new entity becomes user-creatable, or a listed subset changes materially. Use **Implemented** only for a complete user workflow covering persistence, rendering, selection/editing, undo/redo, layout rendering, and relevant tests.
