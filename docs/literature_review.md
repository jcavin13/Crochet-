# Literature review: computational crochet and the stitch graph

This review covers the research and tools behind the project's core abstraction, the **stitch graph**. In that graph, nodes are stitches. Each stitch has edges to the stitch, chain-space or ring it is worked into, and to its neighbours in the same round. The tools built on it are:

- text notation <-> graph <-> symbol chart;
- a row counter;
- a mass-spring relaxation visualizer;
- a flatness checker;
- a generative doily designer;
- later, 3D mesh -> pattern.

**How sources were checked.** Each source below was checked with a web search in November 2026. The check confirmed that a record exists with the stated title, authors, year and venue. A DOI is given only where a publisher record, the authors' own PDF or a bibliographic database returned it. Otherwise the link goes to the authors' or publisher's page. Anything that could not be confirmed is listed in the last section, not in the main text. The summaries come from abstracts, publisher pages and the authors' project pages. They are not a full re-reading of every paper. Before quoting a specific number or claim from a paper, read the paper itself.

---

## 1. Computational crochet and amigurumi design

### 1.1 Edelstein, Peleg, Itzhaky, Ben-Chen — *AmiGo: Computational Design of Amigurumi Crochet Patterns* (2022)
- Venue: Proceedings of the 7th ACM Symposium on Computational Fabrication (SCF '22), Seattle, Article 5.
- Links: DOI [10.1145/3559400.3562005](https://doi.org/10.1145/3559400.3562005) · arXiv [2211.01178](https://arxiv.org/abs/2211.01178)
- Authors: Michal Edelstein, Hila Peleg, Shachar Itzhaky, Mirela Ben-Chen (Technion). The surname is spelled "Itzhaky". It is sometimes misspelled "Itzhaki".

The input is a closed triangle mesh and one seed point chosen by the user. The output is crochet instructions that, once worked and stuffed, look like the input shape. The method computes geodesic distance from the seed and samples the equidistant curves as rows. Stitches are placed non-uniformly along those rows, guided by curvature. The result is a **"Crochet Graph"**: an abstract graph of stitch heads and bases with row edges and column edges, not a yarn-level model. The graph is then translated into a written pattern. The shape is split automatically into parts that are crocheted onto each other as you go, so no sewing is needed. The authors argue that tools for computational knitting do not carry over directly to crochet.

**What it means for this project.** AmiGo's Crochet Graph is almost exactly this project's stitch graph: row edges between neighbours in a round, and column edges to the stitch worked into. This is strong prior art that the abstraction is sufficient for mesh -> pattern. It also gives a ready pipeline for the later mesh -> pattern tool: geodesic rows from a seed, then per-row stitch sampling, then turning the graph into instructions. The data model should allow several connected components joined at attachment edges, because AmiGo's no-sew segmentation needs this. Keep the graph abstract and stitch-level, as AmiGo does. Yarn-level geometry is not needed for shape prediction.

### 1.2 Ben-Chen, Edelstein — *Amigurumi Crochet Patterns from Geodesic Distances* (2024)
- Venue: Proceedings of Bridges 2024: Mathematics, Art, Music, Architecture, Culture, pp. 369–372 (short paper).
- Link: [archive.bridgesmathart.org/2024/bridges2024-369.html](https://archive.bridgesmathart.org/2024/bridges2024-369.html)

This is a short overview of AmiGo for a maths-and-art audience. The core idea is to compute geodesic distance from a seed point. The equidistant level curves are then sampled non-uniformly, guided by surface curvature. Mean curvature at crease lines guides which stitch types are used.

**What it means for this project.** It is a compact explanation of the algorithm, useful for anyone implementing the mesh -> pattern tool. It also shows that choosing stitch type by curvature is a known technique. For doilies, the same idea applies in reverse: the stitch type and count in each round set the curvature.

### 1.3 Igarashi, Igarashi, Suzuki — *Knitting a 3D Model* (2008)
- Venue: Computer Graphics Forum 27(7), Proceedings of Pacific Graphics 2008, pp. 1737–1743.
- Links: [Eurographics Digital Library](https://diglib.eg.org/handle/10.2312/CGF.v27i7pp1737-1743) · [author PDF](https://www-ui.is.s.u-tokyo.ac.jp/~takeo/papers/yuki_pg08_knit.pdf)
- Authors: Yuki Igarashi, Takeo Igarashi, Hiromasa Suzuki. Jun Mitani is not an author.

The system covers a 3D model's surface with parallel winding strips of constant width. It then samples those strips to produce a hand-knitting pattern for knitted stuffed animals.

**What it means for this project.** This is the earliest well-known mesh -> handcraft-pattern pipeline. The "constant-width strips" idea is the same as crochet rounds of constant stitch height. In both cases, the stitch height `h` is the spacing between rows, and the number of stitches per row follows from the row's length.

### 1.4 Igarashi, Igarashi, Suzuki — *Knitty: 3D Modeling of Knitted Animals with a Production Assistant Interface* (2008)
- Venue: Eurographics 2008 Short Papers (Annex to the Conference Proceedings), pp. 187–190.
- Links: [Eurographics Digital Library](https://diglib.eg.org/items/3f313726-d818-4525-b19c-a59fd47a7945) · [author PDF](https://www-ui.is.s.u-tokyo.ac.jp/~takeo/papers/yuki_eg08_knitty.pdf)

Knitty is an interactive sketch-based design system for creating knitted animals. Its "production assistant" interface guides the user through making the model.

**What it means for this project.** It is early evidence that the **row counter / production assistant** belongs in the same tool as the designer. The counter should step through the same graph the designer produced, not through a separate text file.

### 1.5 Guo, Lin, Narayanan, McCann — *Representing Crochet with Stitch Meshes* (2020)
- Venue: ACM Symposium on Computational Fabrication (SCF '20).
- Links: [CMU Textiles Lab page](https://textiles-lab.github.io/publications/2020-crochet-meshes) · ACM DL record reported as 10.1145/3424630.3425409 (**DOI not confirmed** — see the unverified list)
- Author-name discrepancy: the Textiles Lab page lists the first author as "Michelle Guo", while Crossref metadata lists "Runbo Guo". See the unverified section.

This paper extends stitch meshes (see §3) to crochet. It adds a special edge type for the **"current loop"**, the loop held on the hook while working. It also adds a library of face types for common crochet stitches. Crochet instructions are produced from the mesh, and the expected yarn geometry is simulated.

**What it means for this project.** Crochet is not a static mesh. It has a single active loop and a strict order of work, and that order is part of the topology. The stitch graph therefore needs a **work-order (yarn-path) edge or index** on top of the "worked-into" and "round-neighbour" edges. Without it, the row counter, the notation export and turning (flat vs. spiral vs. joined rounds) are ambiguous. Treat the stitch library (sc, hdc, dc, …) as data-driven face or node types, as this paper does.

### 1.6 Seitz, Lincke, Rein, Hirschfeld — *Language and Tool Support for 3D Crochet Patterns: Virtual Crochet with a Graph Structure* (2021)
- Venue: Technische Berichte des Hasso-Plattner-Instituts, No. 137 (Universitätsverlag Potsdam).
- Link: [PDF (hpi.de)](https://hpi.de/oldsite/fileadmin/user_upload/hpi/dokumente/publikationen/technische_berichte/tbhpi137.pdf)

The report proposes representing crochet patterns as a graph that software can "understand", and a diagramming system that shows them in 2D and 3D. It also discusses why existing written and charted notations are ambiguous.

**What it means for this project.** This is direct prior art for a graph as the canonical model, with text and chart as views of it. It is a good source of edge cases where notation is ambiguous, and those make good test cases for the notation <-> graph parser.

### 1.7 Seitz, Rein, Lincke, Hirschfeld — *Digital Crochet: Toward a Visual Language for Pattern Description* (2022)
- Venue: Proceedings of the 2022 ACM SIGPLAN International Symposium on New Ideas, New Paradigms, and Reflections on Programming and Software (Onward! '22), Auckland.
- Links: DOI [10.1145/3563835.3567657](https://doi.org/10.1145/3563835.3567657) · [author PDF](https://www.hpi.uni-potsdam.de/swa/publications/media/SeitzReinLinckeHirschfeld_2022_DigitalCrochetTowardAVisualLanguageForPatternDescription_AcmDL.pdf)

The paper proposes a visual, graph-based domain-specific language for crochet patterns, with a prototype editor that shows patterns in 2D and 3D. A user study checks whether the language can express both 2D and 3D patterns and whether it avoids the ambiguities of current notations.

**What it means for this project.** It supports designing the chart editor as a **direct graph editor**: dragging a stitch changes the graph, not a picture. Their user-study findings are a useful checklist for the UI.

### 1.8 Çapunaman, Bingöl, Gürsoy — *Computing Stitches and Crocheting Geometry* (2017)
- Venue: Computer-Aided Architectural Design. Future Trajectories (CAAD Futures 2017), CCIS vol. 724, Springer, pp. 289–305.
- Link: DOI [10.1007/978-981-10-5197-5_16](https://doi.org/10.1007/978-981-10-5197-5_16)

The paper first analyses the computational logic of crocheting 3D objects. It then formalizes that logic as an algorithm that turns parametric (NURBS) surfaces into crochet patterns. The algorithm is calibrated from a physical **10-stitch × 10-row swatch**: the swatch's measured width and height are its main inputs.

**What it means for this project.** It confirms the project's per-stitch **rest width `w` and height `h`** parameters, and that they should be measured from a swatch. This is exactly the input the ArUco gauge-photo tool (§7) will provide. Store gauge as (stitch type, yarn, hook) -> (w, h), not as one global number.

### 1.9 Greer, Mould — *Modeling Crochet Patterns with a Force-directed Graph Layout* (2025)
- Venue: Eurographics Association (Expressive 2025 workshop proceedings, "User Guided Creative Modeling" session).
- Link: DOI [10.2312/exw.20251057](https://doi.org/10.2312/exw.20251057)

The tool parses an amigurumi pattern written row by row, builds a graph of stitches and lays it out in 3D with a force-directed algorithm. The goal is a model that matches the hand-crocheted object in shape and size, so designers can check a pattern before crocheting it. The authors note it could be extended to garments.

**What it means for this project.** This is the closest published equivalent of the planned **mass-spring visualizer**: a graph plus springs plus relaxation, and it is reported to be enough to preview amigurumi shape. It suggests starting with plain spring relaxation on the stitch graph before investing in full shell or yarn simulation. Compare its results with our flatness predictions.

### 1.10 Li, Huang, Hua, Chawla — *CrochetBench: Can Vision-Language Models Move from Describing to Doing in Crochet Domain?* (2025/2026)
- Venue: arXiv preprint (Nov 2025), and Proceedings of ACL 2026 (long paper 604).
- Links: arXiv [2511.09483](https://arxiv.org/abs/2511.09483) · [ACL Anthology](https://aclanthology.org/2026.acl-long.604/)
- Authors: v1 on arXiv lists three authors. Ting Hua was added in v2 and in the ACL version.

CrochetBench is a benchmark of about 6,000 crochet patterns in 55 categories. It tests whether vision-language models can move from describing crochet to producing patterns that work. Model outputs are compiled into the **CrochetPARADE DSL** and validated for syntax and structure, instead of being scored by text similarity.

**What it means for this project.** (a) CrochetPARADE's DSL is becoming a de facto machine-checkable format for crochet. Supporting import/export with it gives the project interoperability and a large test corpus. (b) It shows the value of a validator that checks a pattern's structure, not just its text. Our parser and graph builder should report structural errors such as wrong stitch counts or working into a non-existent stitch. (c) It is the most relevant current ML work. Any future "LLM writes a doily" feature should emit stitch-graph or DSL text and be validated by our own checker, never trusted directly.

### 1.11 Kekkonen — *Crocheting Mathematics* (2023 chapter; arXiv 2025)
- Venue: chapter in *Shapes in Action* (Aalto University, 2023), pp. 137–158; arXiv preprint August 2025.
- Link: arXiv [2508.10597](https://arxiv.org/abs/2508.10597)

This is an expository chapter arguing that crochet is an inherently mathematical craft. The maker must track stitch counts to control curvature. The chapter covers crocheted hyperbolic surfaces and a Möbius band.

**What it means for this project.** It is accessible background for contributors and for user-facing documentation of the flatness checker.

---

## 2. Hyperbolic crochet and the geometry of crochet

### 2.1 Henderson, Taimina — *Crocheting the Hyperbolic Plane* (2001)
- Venue: The Mathematical Intelligencer 23(2), Spring 2001, pp. 17–28.
- Link: [Taimina's page (Cornell)](https://pi.math.cornell.edu/~dtaimina/crochet/hplane.htm). This page has an updated version of the text.

The paper describes three isometric constructions of (approximations to) the hyperbolic plane as surfaces in 3-space: paper annuli, crochet and polyhedra. It relates them to the upper half-plane model. The crocheted version works by **increasing the stitch count at a constant ratio** (for example, one increase every *n* stitches). The circumference then grows exponentially with radius, which is the signature of constant negative curvature.

**What it means for this project.** This is the mathematical basis of the flatness checker. Write `N_k` for the stitch count in round `k`. Rounds grow linearly in radius (`r_k ≈ k·h`).

- Constant-ratio increases give `N_k` roughly exponential, which means a hyperbolic surface (ruffles).
- `N_k ≈ 2πkh/w`, linear in `k`, gives a flat disc.
- Fewer stitches than that, sub-linear, gives a sphere-like cup.

The checker should report the **implied Gaussian curvature per round**, not just a "too many / too few" flag. The designer can then also aim for hyperbolic ruffles on purpose.

### 2.2 Taimina — *Crocheting Adventures with Hyperbolic Planes* (2009; 2nd ed. 2018)
- Venue: A K Peters, 2009 (ISBN 978-1-56881-452-0). 2nd edition: *Crocheting Adventures with Hyperbolic Planes: Tactile Mathematics, Art and Craft for all to Explore*, CRC Press/A K Peters, 2018.
- Links: [Routledge (2nd ed.)](https://www.routledge.com/Crocheting-Adventures-with-Hyperbolic-Planes-Tactile-Mathematics-Art-and/Taimina/p/book/9780367375072) · [author page](https://pi.math.cornell.edu/~dtaimina/hypplanes.htm)

A book-length treatment of hyperbolic geometry through crochet models, with instructions, history and applications. The first edition won the Euler Book Prize.

**What it means for this project.** It is a source of reference models with known curvature, useful as **regression tests for the physics visualizer**. A pseudosphere or a hyperbolic plane with ratio *n* should relax to a predictable shape.

### 2.3 Osinga, Krauskopf — *Crocheting the Lorenz Manifold* (2004)
- Venue: The Mathematical Intelligencer 26(4), 2004, pp. 25–37.
- Links: [project page (Auckland)](https://www.math.auckland.ac.nz/~hinke/crochet/) · [preprint (Bristol)](https://research-information.bris.ac.uk/ws/files/2998541/ok_preprint.pdf)

The authors turned their numerical algorithm for computing the 2D stable manifold of the Lorenz system into crochet instructions. The algorithm grows the manifold as geodesic level sets. Points are added or removed between successive rings to keep the mesh spacing constant, and that maps exactly to increases and decreases. The finished model has 25,511 stitches.

**What it means for this project.** This is the clearest published demonstration that **"geodesic rings + add or remove points to keep constant spacing" is crochet**. It is the same algorithm as AmiGo (§1.1) and the core of a general surface -> pattern generator. It is also good evidence that pattern generation can be posed as "maintain constant `w` along each ring and constant `h` between rings."

### 2.4 belcastro, Yackel (eds.) — *Making Mathematics with Needlework: Ten Papers and Ten Projects* (2007/2008)
- Venue: A K Peters/CRC Press. The publisher lists December 2007; many reviews cite 2008.
- Link: [Routledge](https://www.routledge.com/Making-Mathematics-with-Needlework-Ten-Papers-and-Ten-Projects/belcastro-Yackel/p/book/9781568813318)

An edited volume pairing mathematical papers with needlework projects (knitting, crochet, quilting, cross-stitch). Examples include Sierpinski crochet, knitted tori and symmetry in cross-stitch.

**What it means for this project.** It is a source of mathematically defined test patterns, such as fractal and symmetric motifs, for the generative doily designer. It also shows that symmetry groups are a natural parameter for doily generation.

---

## 3. Knitting and yarn-level simulation, and machine-knitting compilers

### 3.1 Kaldor, James, Marschner — *Simulating Knitted Cloth at the Yarn Level* (2008)
- Venue: ACM SIGGRAPH 2008, published in ACM Transactions on Graphics 27(3).
- Link: [project page (Cornell)](https://www.cs.cornell.edu/~srm/publications/SG08-knit.html)

Each yarn is modelled as an inextensible but otherwise flexible B-spline tube. Contact between yarns is resolved, and an implicit-explicit integrator with inextensibility projections simulates whole knitted garments.

**What it means for this project.** Yarn-level simulation gives realistic drape and stretch, but it is orders of magnitude more expensive than a stitch-level spring model. For the visualizer and flatness checker, a **stitch-level model** (one node per stitch, as in AmiGo and Greer & Mould) is the right level of detail. Yarn-level modelling should be a later "render" step, not the shape solver.

### 3.2 Kaldor, James, Marschner — *Efficient Yarn-based Cloth with Adaptive Contact Linearization* (2010)
- Venue: ACM Transactions on Graphics 29(4), Article 105 (SIGGRAPH 2010).
- Links: [project page](https://www.cs.cornell.edu/projects/YarnCloth) · [paper PDF](https://research.cs.cornell.edu/YarnCloth/sg10_acl.pdf)

The paper speeds up yarn-level cloth by linearizing yarn–yarn contact forces. The exact response is computed at one configuration, and a rotated linear model is reused for nearby deformed configurations.

**What it means for this project.** It confirms that yarn-level contact is the bottleneck, which reinforces keeping it out of the interactive loop.

### 3.3 Yuksel, Kaldor, James, Marschner — *Stitch Meshes for Modeling Knitted Clothing with Yarn-level Detail* (2012)
- Venue: ACM Transactions on Graphics 31(4) (SIGGRAPH 2012).
- Links: [project page](https://www.cs.cornell.edu/projects/stitchmeshes/) · [paper PDF](https://research.cs.cornell.edu/stitchmeshes/stitchmeshes.pdf)

The paper introduces the **stitch mesh**: a polygon mesh whose faces are typed stitches, and whose edges are labelled as row edges (yarn-wise) or column edges (wale-wise). Yarn curves are generated per face and then relaxed with yarn-level simulation.

**What it means for this project.** The stitch mesh is the **dual** of the stitch graph: faces there are nodes here. The two are interchangeable. A stitch mesh gives faces and a surface for rendering, and a graph is easier for notation. Keep a stitch graph -> stitch mesh conversion in mind for the 3D renderer and for borrowing stitch-mesh algorithms. Its labelling of edges as row or column edges matches our "neighbour in round" and "worked-into" edges.

### 3.4 Wu, Gao, Ferguson, Panozzo, Yuksel — *Stitch Meshing* (2018)
- Venue: ACM Transactions on Graphics 37(4), Article 130 (SIGGRAPH 2018).
- Links: DOI [10.1145/3197517.3201360](https://doi.org/10.1145/3197517.3201360) · [paper PDF](https://people.csail.mit.edu/kuiwu/stitchmeshing/StitchMeshing.pdf)

The paper builds stitch meshes automatically from arbitrary 3D surfaces. It uses field-aligned quad meshing guided by the row and column directions, then fixes up singularities with special stitch types.

**What it means for this project.** For the mesh -> pattern tool, it shows that singular points (places where the row/column structure cannot be regular) are unavoidable on curved surfaces and must map to special stitches, like increases and decreases in crochet. The stitch graph must allow nodes whose valence is not 4 (an increase has two stitches worked into one base; a decrease is the reverse) as first-class nodes, not exceptions.

### 3.5 Wu, Swan, Yuksel — *Knittable Stitch Meshes* (2019)
- Venue: ACM Transactions on Graphics 38(1).
- Links: DOI [10.1145/3292481](https://doi.org/10.1145/3292481) · [paper PDF](https://people.csail.mit.edu/kuiwu/knittable/knittable.pdf)

The paper adds constraints so that a generated stitch mesh can actually be hand-knitted, as one continuous yarn path in a valid order, and produces instructions from it.

**What it means for this project.** Being able to fabricate the result is a **global ordering constraint**, not a local one. A graph can be locally valid but impossible to work as a single strand in order. The project needs a validator that checks a valid working order exists (each stitch's "worked-into" target is created before it, and there is one continuous active loop or explicit fasten-off/join events). This repeats the "current loop" point from Guo et al.

### 3.6 McCann, Albaugh, Narayanan, Grow, Matusik, Mankoff, Hodgins — *A Compiler for 3D Machine Knitting* (2016)
- Venue: ACM Transactions on Graphics 35(4) (SIGGRAPH 2016).
- Links: DOI [10.1145/2897824.2925940](https://doi.org/10.1145/2897824.2925940) · [MIT DSpace](https://dspace.mit.edu/handle/1721.1/134995)

The compiler turns high-level shape primitives (tubes, sheets) into low-level instructions for industrial V-bed knitting machines. Its core is a transfer-planning algorithm that is heuristic but proven sound and complete.

**What it means for this project.** It is a model for a **layered architecture**: high-level design -> intermediate graph -> low-level instruction stream, with a proven-correct lowering step. For us, the lowering target is human-readable instructions (written pattern, chart, row-counter steps) rather than machine needles. The principle is the same: keep these as separate, testable stages.

### 3.7 Narayanan, Albaugh, Hodgins, Coros, McCann — *Automatic Machine Knitting of 3D Meshes* (2018)
- Venue: ACM Transactions on Graphics 37(3), Article 35.
- Links: DOI [10.1145/3186265](https://doi.org/10.1145/3186265) · [project page](https://textiles-lab.github.io/publications/2018-autoknit)

The pipeline turns arbitrary 3D meshes into machine-knitting instructions. It computes a time function over the surface, extracts rows as its level sets, builds a knit graph and schedules it onto the machine.

**What it means for this project.** "Scalar time field -> level-set rows -> graph -> schedule" is the knitting counterpart of AmiGo's geodesic rows, and it can be used directly for mesh -> crochet. Their **knit graph** (stitches as nodes, row and wale edges) supports the stitch graph as the IR.

### 3.8 Narayanan, Wu, Yuksel, McCann — *Visual Knitting Machine Programming* (2019)
- Venue: ACM Transactions on Graphics 38(4), Article 63 (SIGGRAPH 2019).
- Links: DOI [10.1145/3306346.3322995](https://doi.org/10.1145/3306346.3322995) · [project page](https://textiles-lab.github.io/publications/2019-visualknit)

A visual programming interface built on an augmented stitch mesh. Users edit surface stitch patterns on 3D knitted objects, and the result is guaranteed to be knittable.

**What it means for this project.** It supports a chart editor where **every edit stays valid by construction**, with the editor checking validity live. For our symbol-chart editor: run the structural validator on every edit and refuse or flag edits that make the graph impossible to crochet.

### 3.9 Leaf, Wu, Schweickart, James, Marschner — *Interactive Design of Periodic Yarn-Level Cloth Patterns* (2018)
- Venue: ACM Transactions on Graphics 37(6), Article 202 (SIGGRAPH Asia 2018).
- Links: DOI [10.1145/3272127.3275105](https://doi.org/10.1145/3272127.3275105) · [project page](https://graphics.stanford.edu/projects/yarnsim)

Yarn-level simulation becomes interactive by simulating only a small **periodic patch** with periodic boundary conditions. Users can design knit and woven patterns and see the result immediately.

**What it means for this project.** It suggests a way to calibrate the stitch-level model. Material properties of a repeating pattern (lace motif stiffness, effective `w`/`h`) can be estimated on a small periodic tile. Those values then feed the stitch-level spring model, instead of simulating the whole doily at yarn level.

### 3.10 Hofmann, Albaugh, Sethapakdi, Hodgins, Hudson, McCann, Mankoff — *KnitPicking Textures: Programming and Modifying Complex Knitted Textures for Machine and Hand Knitting* (2019)
- Venue: Proceedings of UIST '19, pp. 5–16. This is a UIST paper, not CHI.
- Links: DOI [10.1145/3332165.3347886](https://doi.org/10.1145/3332165.3347886) · [PDF (NSF PAR)](https://par.nsf.gov/servlets/purl/10191362)

KnitPick turns hand-knitting texture patterns into **KnitGraphs**, which can be output as either machine or hand-knitting instructions. It includes algorithms that reshape a graph while keeping its texture (KnitCarving) and that combine graphs with different textures (KnitPatching). It also contributes a measured, photographed dataset of 472 knitted textures.

**What it means for this project.** (a) It is a precedent for one graph exported to **several instruction targets** (hand and machine). For us the targets are written pattern, symbol chart and row counter. (b) It is a precedent for a measured texture dataset. A measured crochet stitch-gauge dataset, built with the §7 photo tool, would be a useful project contribution. (c) "Graph surgery that keeps the texture" maps directly onto resizing a doily motif.

### 3.11 Kaspar, Oh, Makatura, Kellnhofer, Matusik — *Neural Inverse Knitting: From Images to Manufacturing Instructions* (2019)
- Venue: Proceedings of ICML 2019, PMLR 97, pp. 3272–3281.
- Links: [PMLR](https://proceedings.mlr.press/v97/kaspar19a.html) · arXiv [1902.02752](https://arxiv.org/abs/1902.02752) · [project page](https://deepknitting.csail.mit.edu)
- Author note: arXiv v1 and the project page also list Jacqueline Aslarus. The PMLR version does not.

A network maps photos of knitted fabric to a grid of machine-knitting instructions, trained on synthetic renders plus real images.

**What it means for this project.** It is a precedent for photo -> pattern. It works because the knit output is a **regular grid** of instructions. Crochet doilies are radial and irregular, so an equivalent model should predict a stitch graph, or at least a per-round sequence, rather than a grid. This is a reason not to force crochet into a grid data model.

### 3.12 Kaspar, Makatura, Matusik — *Knitting Skeletons: A Computer-Aided Design Tool for Shaping and Patterning of Knitted Garments* (2019)
- Venue: Proceedings of UIST '19.
- Links: DOI [10.1145/3332165.3347879](https://doi.org/10.1145/3332165.3347879) · arXiv [1904.05681](https://arxiv.org/abs/1904.05681) · [project page](https://knitskel.csail.mit.edu)

A CAD tool that combines parametric knitted shape primitives (a "skeleton") with stitch-pattern layers that resample as the shape changes. Its web interface and source are released.

**What it means for this project.** It supports **separating shape from stitch pattern**. In a doily, the "skeleton" is the radial round structure and the "pattern layer" is the repeating lace motif. The generative designer can work with these as independent parameters, for example symmetry order × motif × number of rounds.

### 3.13 McCann et al. — *The "Knitout" (.k) File Format* (specification, 2017–)
- Link: [spec v0.6 (CMU Textiles Lab)](https://textiles-lab.github.io/knitout/knitout.html)

Knitout is a machine-independent text format for low-level knitting-machine instructions. It is designed as both the output of design tools and the input to machines and simulators. Files start with a magic version string and a header of `;;` comments.

**What it means for this project.** It is a good model for **our own line-oriented interchange format**: versioned, with a header, simple to parse, with one operation per line, and machine-independent. A crochet equivalent ("one line per stitch operation, in work order") would be the natural format to serialize the stitch graph's work order, and the natural input for the row counter.

### 3.14 KnitML — *Knitting Markup Language* (open-source project, 2007–)
- Link: [SourceForge project](https://sourceforge.net/projects/knitml/)

An XML-based markup language meant as a software interchange format for knitting patterns, written in Java and released around 2007–2008. Development appears to have been intermittent and has stalled.

**What it means for this project.** It is a cautionary precedent. A verbose interchange format without a strong visual tool and a community did not gain adoption. Prioritize a terse human-writable notation and good tools over a comprehensive XML schema.

### 3.15 Gray, Bell, Kobourov — *A Graph Model and a Layout Algorithm for Knitting Patterns* (2024)
- Venue: arXiv preprint (cs.HC), June 2024.
- Link: arXiv [2406.13800](https://arxiv.org/abs/2406.13800)

A graph model of knitting patterns with a layout algorithm that draws them, framed from a graph-drawing perspective.

**What it means for this project.** Graph-drawing methods are relevant to **chart layout**: producing a readable 2D symbol chart from the stitch graph is a constrained graph-layout problem. For doilies, the constraint is concentric rounds.

### 3.16 Gray, Bell, Sieper, Kobourov, Schreiber, Klein, Hong — *Wooly Graphs: A Mathematical Framework for Knitting* (2024)
- Venue: arXiv preprint (cs.DS), June 2024.
- Link: arXiv [2407.00511](https://arxiv.org/abs/2407.00511)

The paper proposes three graph models for arbitrary knitted objects: a simple undirected graph, a simple directed graph and a **directed multigraph**. It discusses what each can and cannot represent.

**What it means for this project.** It is directly relevant to the stitch graph's formal type. Crochet often works several stitches into the same base (increases, shells, many stitches into one chain-space) and joins one stitch to several bases. The stitch graph should be a **directed multigraph with typed edges**, not a simple graph.

---

## 4. Discrete differential geometry and simulation

### 4.1 Meyer, Desbrun, Schröder, Barr — *Discrete Differential-Geometry Operators for Triangulated 2-Manifolds* (2002/2003)
- Venue: VisMath 2002, published in *Visualization and Mathematics III*, Springer, 2003, pp. 35–57.
- Links: DOI [10.1007/978-3-662-05105-4_2](https://doi.org/10.1007/978-3-662-05105-4_2) · [author PDF (Caltech)](https://authors.library.caltech.edu/records/0rsjd-50h08)

The paper derives consistent discrete operators on triangle meshes: the cotangent Laplace–Beltrami operator, mean curvature normal and **Gaussian curvature as angle deficit** (2π minus the sum of incident angles, divided by a mixed Voronoi area).

**What it means for this project.** This is the reference formula for a **general flatness checker**. Triangulate the stitch graph using rest lengths `w` (along rounds) and `h` (to the stitch worked into). Then compute the angle deficit at each node from rest lengths alone, before any simulation:

- deficit ≈ 0: flat;
- deficit > 0: cupping;
- deficit < 0: ruffling.

This generalizes `N_k ≈ 2πkh/w` to non-circular motifs, squares, hexagons and local lace features, and it localizes the problem to specific stitches.

### 4.2 Crane — *Discrete Differential Geometry: An Applied Introduction* (course notes, CMU)
- Link: [course page](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/) · [notes PDF](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)

Course notes for CMU's DDG course, covering discrete curves and surfaces, discrete exterior calculus, curvature and the discrete Gauss–Bonnet theorem: for a closed mesh, the sum of the angle deficits is 2πχ.

**What it means for this project.** It is a teaching reference for contributors. **Gauss–Bonnet gives a free global sanity check** on the flatness checker and the mesh -> pattern tool. For a closed amigurumi sphere (χ = 2), the total deficit over the stitch graph must be 4π. For a flat doily, the interior deficit plus the boundary geodesic-curvature term must equal 2π. A mismatch indicates a bug in the triangulation or the rest lengths.

### 4.3 Grinspun, Hirani, Desbrun, Schröder — *Discrete Shells* (2003)
- Venue: ACM SIGGRAPH/Eurographics Symposium on Computer Animation (SCA 2003), pp. 62–67.
- Links: DOI [10.2312/SCA03/062-067](https://doi.org/10.2312/SCA03/062-067) · [project page](https://multires.caltech.edu/pubs/DS-CDROM)

A simple, geometrically derived bending energy for triangle meshes with curved rest shapes, based on dihedral angles across edges. It is implemented by changing a standard cloth simulator.

**What it means for this project.** A mass-spring model with only in-plane springs has **no bending stiffness**. Such a model cannot choose between cupping and the many possible ruffle modes: a "too many stitches" disc will crumple at random. Add a discrete-shell bending term (dihedral angle across each stitch-graph triangle edge) with a stiffness parameter per stitch type. Thread thickness and stitch height drive that stiffness.

### 4.4 Klein, Efrati, Sharon — *Shaping of Elastic Sheets by Prescription of Non-Euclidean Metrics* (2007)
- Venue: Science 315(5815), pp. 1116–1120.
- Link: DOI [10.1126/science.1135994](https://doi.org/10.1126/science.1135994)

Gel sheets were made to shrink unevenly in-plane, which **prescribes a non-Euclidean target metric**. The sheets buckle into 3D shapes. Depending on the metric, large-scale buckling or multiscale wrinkling appears.

**What it means for this project.** This is the physics framing for crochet: the stitch rest lengths `(w, h)` per stitch **are** a prescribed metric. A doily lies flat only if that metric is Euclidean (zero Gaussian curvature). Otherwise it must buckle. It confirms that the flatness checker should reason about the **target metric**, which is computable from the graph alone, and treat the 3D relaxation as a separate, secondary prediction.

### 4.5 Efrati, Sharon, Kupferman — *Elastic Theory of Unconstrained Non-Euclidean Plates* (2009)
- Venue: Journal of the Mechanics and Physics of Solids 57, pp. 762–775.
- Link: arXiv [0810.2411](https://arxiv.org/abs/0810.2411)

The paper builds a reduced 2D elastic theory for thin plates with a non-Euclidean reference metric. The energy is split into stretching and bending terms, and the balance between them scales with thickness. In the thin limit, the sheet approaches an isometric embedding of the target metric with minimal bending.

**What it means for this project.** It gives the **energy to minimize**: stretching (deviation from the rest `w`, `h`) plus thickness² × bending. It tells us the stitch-level solver should be **quasi-static energy minimization**, not a time-accurate dynamics simulation. It also says that thicker thread or taller stitches favour stretching over buckling. Thread weight should therefore be an input to the visualizer, not just to the gauge.

### 4.6 Sharon, Roman, Marder, Shin, Swinney — *Buckling Cascades in Free Sheets* (2002)
- Venue: Nature 419, p. 579 (brief communication, 10 October 2002).
- Links: [HUJI research portal](https://cris.huji.ac.il/en/publications/buckling-cascades-in-free-sheets/) · [PDF (ESPCI)](https://blog.espci.fr/benoitroman/files/2018/04/Sharon02.pdf)

Torn plastic sheets with excess length at the edge develop a **self-similar cascade of up to six generations of waves**, and the scaling depends on sheet thickness. The authors suggest this mechanism shapes wavy leaf and flower edges.

**What it means for this project.** It explains why ruffled crochet edges look the way they do. It also warns that **the number and size of ruffles is not determined by geometry alone**: thickness, and in crochet thread weight and stitch stiffness, matter. The flatness checker can predict reliably *that* an edge ruffles and by how much excess length. Predicting *how many* waves needs the bending term (§4.3) and calibrated stiffness, so present that output as approximate.

### 4.7 Provot — *Deformation Constraints in a Mass-Spring Model to Describe Rigid Cloth Behaviour* (1995)
- Venue: Proceedings of Graphics Interface '95, pp. 147–154.
- Links: DOI [10.20380/GI1995.17](https://doi.org/10.20380/GI1995.17) · [PDF](https://graphicsinterface.org/wp-content/uploads/gi1995-17.pdf)

The classic mass-spring cloth model with structural, shear and flexion springs. It shows that stiff springs force tiny explicit time steps. Instead of stiffening the springs, it limits over-stretched springs by directly correcting positions.

**What it means for this project.** Crochet thread is close to inextensible. Naive explicit mass-spring with stiff springs will be unstable or slow, which is exactly Provot's problem. Use a position-correction method (Provot-style or PBD/XPBD), or implicit integration. Provot's structural/shear/flexion split also suggests the minimum spring set per stitch: along the round (`w`), to the base (`h`), diagonals (shear) and skip-one springs (bending).

### 4.8 Baraff, Witkin — *Large Steps in Cloth Simulation* (1998)
- Venue: Proceedings of SIGGRAPH '98, pp. 43–54.
- Links: DOI [10.1145/280814.280821](https://doi.org/10.1145/280814.280821) · [PDF](https://www.cs.cornell.edu/courses/cs667/2005sp/readings/baraff98.pdf)

Implicit integration with a modified conjugate-gradient solver allows large, stable time steps for stiff cloth, with constraints enforced exactly.

**What it means for this project.** It is the reference for implicit integration if we need real dynamics, for example a doily hanging or draping. For the "relax to rest shape" use case, implicit Euler with large steps is effectively energy minimization, so a static solver may be simpler.

### 4.9 Müller, Heidelberger, Hennix, Ratcliff — *Position Based Dynamics* (2007)
- Venue: Journal of Visual Communication and Image Representation 18(2), pp. 109–118. An earlier version appeared at VRIPHYS 2006.
- Link: DOI [10.1016/j.jvcir.2007.01.005](https://doi.org/10.1016/j.jvcir.2007.01.005)

PBD skips forces and directly projects particle positions to satisfy constraints (distance, bending, collision) iteratively. It is unconditionally stable and easy to implement, so it is widely used in games.

**What it means for this project.** It is a good fit for an **interactive in-browser visualizer**: stable with inextensible threads, simple, and easy to run in JS/WebGL or WASM. Caveat: in classic PBD, effective stiffness depends on iteration count and time step. That is a problem for a checker that must give repeatable results, and XPBD fixes it.

### 4.10 Macklin, Müller, Chentanez — *XPBD: Position-Based Simulation of Compliant Constrained Dynamics* (2016)
- Venue: Proceedings of Motion in Games (MIG '16), pp. 49–54.
- Links: DOI [10.1145/2994258.2994272](https://doi.org/10.1145/2994258.2994272) · [PDF](https://matthias-research.github.io/pages/publications/XPBD.pdf)

XPBD extends PBD with a compliance per constraint, so stiffness has physical meaning and does not depend on iteration count or time step.

**What it means for this project.** **Recommended default solver** for the visualizer. Per-stitch stiffness maps directly to XPBD compliance, and results are reproducible across devices and frame rates. That matters if the visualizer's output is used to justify flatness verdicts.

### 4.11 Bouaziz, Martin, Liu, Kavan, Pauly — *Projective Dynamics: Fusing Constraint Projections for Fast Simulation* (2014)
- Venue: ACM Transactions on Graphics 33(4) (SIGGRAPH 2014).
- Links: DOI [10.1145/2601097.2601116](https://doi.org/10.1145/2601097.2601116) · [project page](https://users.cs.utah.edu/~ladislav/bouaziz14projective/bouaziz14projective.html)

Projective Dynamics alternates local constraint projections with a global linear solve whose matrix is constant and can be prefactored. It sits between PBD and full implicit FEM: it minimizes a well-defined energy and is fast.

**What it means for this project.** It is the strongest candidate for an **offline or "accurate mode" solver** and for the mesh -> pattern verification loop. The stitch graph's topology is fixed during relaxation, so the global matrix can be prefactored once per pattern. It also directly minimizes the stretch + bending energy of §4.5.

---

## 5. Existing crochet software and apps

### 5.1 CrochetPARADE (Svetlin Tassev)
- Links: [crochetparade.org](https://www.crochetparade.org/) · [Codeberg repository](https://codeberg.org/crochetparade/CrochetPARADE)
- Licence: third-party listings give GPL-3.0 for the software and CC BY-NC-SA for the manual. Check the repository before relying on either.

CrochetPARADE is the "Crochet PAttern Renderer, Analyzer, and DEbugger". It is a web platform with a custom pattern language that describes crochet precisely. It renders 2D and 3D models, flags structural problems and stitches likely to be too loose or tight, exports SVG charts and animates stitch connections. CrochetBench uses it as the validation backend (§1.10).

**Gap / implications.** CrochetPARADE is the closest existing tool to this project's vision, so it must be acknowledged and differentiated. It is **DSL-first**: the text language is canonical. This project is **graph-first**, with a round-trip symbol-chart editor, a dedicated flatness/curvature checker, a doily generator and a measured-gauge workflow. **Recommendation: implement CrochetPARADE import (and ideally export)** rather than competing with its language, and study its analysis features before reinventing them.

### 5.2 Stitch Fiddle
- Link: [stitchfiddle.com](https://www.stitchfiddle.com/)

Stitch Fiddle is a browser-based chart designer for knitting, crochet and cross-stitch, with free and premium tiers. Charts can be downloaded as SVG for editing in vector tools. It is built mainly around grid charts (colourwork, filet, C2C), with symbol support.

**Gap.** It is grid-based and pictorial. It has no model of what each stitch is worked into, so it cannot check stitch counts, curvature or whether a pattern can be worked. Radial doily charts are not its strength.

### 5.3 Crochet Charts (Stitch Works Software)
- Links: [user guide (v1.2)](https://www.scribd.com/document/395108170/Crochet-Charts-User-Guide-1-2) · [Softpedia changelog](https://www.softpedia.com/progChangelog/Crochet-Charts-Changelog-235430.html)

Crochet Charts is a desktop symbol-chart program aimed at symbol-crochet designers. A 2013 review reports about 109 scalable, rotatable symbols. Version 1.2 was relicensed as **GPL v3** and made free, according to its user guide. The source is reported to be at `github.com/iPenguin/CrochetCharts`. Its current state is unconfirmed.

**Gap / implications.** It is a drawing tool: symbols are placed freely, with no connection to a stitch model. Being GPL, it may be a source of a symbol set or of UI ideas. Any code reuse brings GPL obligations, so decide the project licence with that in mind.

### 5.4 Ribblr
- Links: [ribblr.com/craft-patterns/interactive](https://ribblr.com/craft-patterns/interactive) · [row tracking guide](https://ribblr.com/learn/crochet-row-tracking)

Ribblr is a pattern marketplace and app with interactive "ePatterns". They include line tracking (which instruction line you are on), a repeat or row counter launched from "repeat" instructions, notes and progress, all inside the pattern.

**Gap / implications.** Its row tracking works on **text lines** of the pattern, not on stitches. Ribblr's split between a "row counter" (which round) and "line tracking" (which instruction) is useful UX prior art. Because our counter is driven by the graph, it can go further: track the exact stitch, show the current position on the chart, and know the expected stitch count at the end of the round.

### 5.5 Row-counter apps (representative)
- Example: [My Row Counter, Knit & Crochet (App Store)](https://apps.apple.com/app/id1342608792)

Standalone counter apps give counters, reminders at specific rows and PDF pattern import, but have no understanding of the pattern's structure.

**Gap.** They count. They do not check. A graph-driven counter can warn when the user's count disagrees with the pattern, and it can resume at an exact stitch.

### 5.6 Knitting-side tooling (knitout, KnitML, KnitPick, Knitting Skeletons)
See §3.10–3.14. The knitting community already has a low-level standard IR (knitout) and research tools built on graphs. Crochet has no equivalent open IR. Providing one, a stitch-graph serialization plus a knitout-like work-order stream, is a clear gap this project can fill.

---

## 6. Crochet notation standards

### 6.1 Craft Yarn Council — Crochet abbreviations
- Link: [craftyarncouncil.com/standards/crochet-abbreviations](https://craftyarncouncil.com/standards/crochet-abbreviations)

The US industry list of crochet abbreviations (sc, hdc, dc, tr, sc2tog, yo, …), with a section mapping US terms to UK/Canadian terms. The page warns that designers may define special abbreviations that are not on the list.

**What it means for this project.** It is the baseline vocabulary for the text-notation parser. **US vs. UK terminology** is a naming layer:

| US | UK |
|----|----|
| sc | dc |
| hdc | htr |
| dc | tr |
| tr | dtr |

So the same token (`dc`) means different stitches in the two dialects. The parser must take an explicit **dialect setting**. Internally, store stitches by a structural definition (number of yarn-overs before insertion, number of pull-throughs), never by a name. Patterns also define their own special stitches, so the stitch library must be user-extensible (macro or definition syntax).

### 6.2 Craft Yarn Council — Crochet chart symbols
- Link: [craftyarncouncil.com/standards/crochet-chart-symbols](https://craftyarncouncil.com/standards/crochet-chart-symbols)

The CYC's standardized crochet symbols. Chain is an oval, sc a cross or "+", and hdc/dc/tr are a "T" with one hatch per yarn-over. There are also decreases (sc2tog, dc2tog, …) and other stitches. The CYC asks that publications using the standards notify it and credit "Source: Craft Yarn Council www.YarnStandards.com".

**What it means for this project.** It is the default symbol set for the chart renderer. The hatch-per-yarn-over rule is **compositional**, so symbols can be **generated from the structural stitch definition** instead of being drawn one by one. Check the CYC's terms before bundling their artwork. Generated glyphs avoid the question.

### 6.3 Craft Yarn Council — Standard Yarn Weight System and hooks/needles
- Links: [Yarn weight system](https://craftyarncouncil.com/standards/yarn-weight-system) · [Hooks and needles](https://www.craftyarncouncil.com/standards/hooks-and-needles)

Yarn weight categories 0 (lace) to 7 (jumbo), with recommended gauge and hook ranges. Hook tables map millimetres to US letter/number sizes. The CYC recommends going by millimetres, because letter and number designations vary between makers. Steel hooks (used for thread lace and doilies) are numbered in reverse: higher numbers are smaller.

**What it means for this project.** Store **hook size in mm** and **yarn weight category** as the canonical gauge inputs, and treat US/UK/steel numbers as display formats. Doilies are mostly worked in thread (category 0) on steel hooks. The default `w`/`h` tables must cover thread and steel hooks, not just worsted yarn. Category tables give only rough guidance, and real `w`/`h` must come from a swatch (§1.8, §7).

### 6.4 JIS L 0201 — *Letter Symbols for Knitting Stitch* (Japanese Standards Association, 1995)
- Links: [Accuris store listing (JSA standards, clothing industry)](https://store.accuristech.com/subgroups/17364) · usage example: [marnen/knitting_symbols](https://marnen.github.io/knitting_symbols)

The standard is listed as JIS L 0201, "Letter Symbols for Knitting Stitch", dated 1995-11-01, in English and Japanese. A companion standard, JIS L 0200, "Method of Representation for Knitting Stitch", is dated 1976. Open-source symbol sets describe their Japanese knitting glyphs as "defined in the JIS L0201 standard and commonly used in Japanese publications".

**What it means for this project.** The title and number are confirmed. **Whether JIS L 0201 itself defines crochet (かぎ針) symbols could not be confirmed** (see the unverified section). In practice, Japanese crochet publications use a chart-only convention, often with no written instructions, which is visually close to the CYC set. Japanese charts are known to use their own glyph variants and conventions, but no authoritative side-by-side comparison was found. **Implication:** make the symbol set a **pluggable style map** (CYC style, Japanese style, user-defined) over the same structural stitch definitions, and never hard-code glyph shapes into the graph.

---

## 7. Fiducial-marker measurement for the swatch-gauge tool

### 7.1 Garrido-Jurado, Muñoz-Salinas, Madrid-Cuevas, Marín-Jiménez — *Automatic Generation and Detection of Highly Reliable Fiducial Markers under Occlusion* (2014)
- Venue: Pattern Recognition 47(6), pp. 2280–2292.
- Link: DOI [10.1016/j.patcog.2014.01.005](https://doi.org/10.1016/j.patcog.2014.01.005)

This is the ArUco paper. It covers generating marker dictionaries with large inter-marker distance, robust detection with error correction, and handling occlusion.

**What it means for this project.** Printing an ArUco or ChArUco card at known physical size and placing it next to a swatch gives metric scale and corrects perspective from a single phone photo. The user then marks, or the tool detects, stitch and row boundaries to get `w` and `h` in mm. Occlusion robustness matters, because yarn and fingers will cover parts of the card.

### 7.2 OpenCV — *Detection of ChArUco Boards* (documentation)
- Links: [OpenCV 4.x tutorial](https://docs.opencv.org/4.x/df/d4a/tutorial_charuco_detection.html) · [ArUco FAQ](https://docs.opencv.org/4.x/d1/dcb/tutorial_aruco_faq.html)

ChArUco boards combine a chessboard with ArUco markers. The markers identify each chessboard corner, and the corners give sub-pixel accuracy. The API changed between versions. Older versions use `interpolateCornersCharuco`; 4.7+ and 5.x use a `CharucoDetector` class.

**What it means for this project.** Use **ChArUco rather than a single ArUco marker**. Chessboard corners are more precise, and partial visibility still works. Pin the OpenCV version (or OpenCV.js build), because the API changed. Estimate the homography from the board to rectify the swatch plane, then measure in mm.

---

## Synthesis: design implications

- **The stitch graph is the right canonical model, and it has been validated by independent prior work.** AmiGo's Crochet Graph (§1.1), Seitz et al.'s graph representation (§1.6–1.7), Greer & Mould's force-directed graph (§1.9), KnitPick's KnitGraph (§3.10) and Narayanan et al.'s knit graph (§3.7) all use essentially the same abstraction. Text and chart should be views of the graph.
- **Make it a typed directed multigraph.** Several stitches into one base, one stitch joined to several bases, chain-spaces and rings all need parallel and typed edges (Wooly Graphs §3.16). Edge types: `worked_into` (to a stitch, chain-space or ring), `round_neighbour` and `work_order` (see next point). Increases and decreases are ordinary nodes with irregular valence (Stitch Meshing §3.4).
- **Architecture change: add an explicit work order (yarn path) to the graph.** Guo et al.'s "current loop" (§1.5) and Knittable Stitch Meshes' global knittability constraint (§3.5) show that adjacency alone does not determine a valid crochet pattern. Store a total order of stitch creation plus explicit join, turn and fasten-off events, and validate that every `worked_into` target exists before it is used. The row counter, notation export and chart numbering all depend on this.
- **Use a layered pipeline with a low-level IR.** Follow McCann et al.'s compiler (§3.6) and knitout (§3.13): design or generator -> stitch graph -> linear work-order stream, a simple versioned line format. The stream then lowers to a written pattern (US/UK), a symbol chart or row-counter steps. The open crochet IR fills a gap that knitting has already filled (§5.6), and KnitML's lack of adoption (§3.14) argues for a terse format.
- **Interoperate with CrochetPARADE instead of competing with it.** It is the closest existing tool (§5.1) and the validation backend for current ML benchmarks (§1.10). Importing and exporting its DSL gives a test corpus and users.
- **Architecture refinement: the flatness checker should compute discrete Gaussian curvature from rest lengths, not only `N_k` vs `2πkh/w`.** The round-count formula is the special case for concentric circles (Henderson & Taimina §2.1). The general tool is the angle deficit (Meyer et al. §4.1) on a triangulation of the stitch graph built from rest `w`/`h`. This is the prescribed metric of non-Euclidean plate theory (Klein et al. §4.4; Efrati et al. §4.5). It handles non-circular motifs, locates problems per stitch and is checked globally by Gauss–Bonnet (Crane §4.2).
  - Sanity check of the round formula: a stitch about as tall as it is wide gives about 2π ≈ 6.3 stitches added per round. A stitch about twice as tall as wide gives about 12.6. This matches the usual crochet rules of thumb of 6 increases per round for sc and 12 for dc. (This is our own derivation, not a claim from a cited source.)
- **Report the sign and size of curvature confidently, and ruffle counts cautiously.** Whether an edge cups or ruffles, and the excess length, follow from geometry. The number and size of waves depend on thickness and stiffness (Sharon et al. §4.6; Efrati et al. §4.5).
- **The physics model needs bending, and should be energy-based.** In-plane springs alone cannot resolve buckling modes. Add a discrete-shell dihedral bending term (Grinspun et al. §4.3) scaled by thread thickness. Treat relaxation as quasi-static minimization of stretch plus bending energy (§4.5).
- **Solver choice.** Avoid naive explicit stiff mass-springs (Provot §4.7). Use **XPBD** (§4.10) for the interactive visualizer: stable, with stiffness that does not depend on iteration count or time step, and reproducible. Use **Projective Dynamics** (§4.11) for accurate offline relaxation and the mesh -> pattern loop, since the fixed topology allows a prefactored global matrix. Baraff & Witkin (§4.8) is the reference if true dynamics such as drape are needed later.
- **Stay at stitch level; do not simulate yarn.** Yarn-level methods (Kaldor et al. §3.1–3.2) are too costly for interactive shape prediction. Stitch-level graphs are enough for amigurumi shape (AmiGo, Greer & Mould). If needed, calibrate stitch-level parameters on small periodic yarn-level patches (Leaf et al. §3.9), or from measured swatches.
- **Gauge is per (stitch type, thread, hook) and should be measured.** This follows from swatch-calibrated algorithms (Çapunaman et al. §1.8) and CYC's advice to rely on mm (§6.3). Doilies need thread/steel-hook defaults. Build the ChArUco photo tool (§7.1–7.2) to produce `w`/`h`. A shared, measured gauge dataset would be a contribution in its own right, as KnitPick's texture dataset was (§3.10).
- **Notation needs an explicit dialect and stitches defined by structure.** US/UK names collide (§6.1). Store stitches by structure (yarn-overs, insertions, pull-throughs). Generate CYC glyphs from that structure (one hatch per yarn-over, §6.2). Make symbol styles (CYC, Japanese, custom) pluggable (§6.4). Allow user-defined special stitches.
- **Editors should keep the graph valid by construction.** Visual Knitting Machine Programming (§3.8) and Digital Crochet (§1.7) support validating every chart edit live against the graph.
- **The mesh -> pattern roadmap is known.** Geodesic or time-field level sets as rounds, with stitch sampling at constant `w`, appear in Osinga & Krauskopf (§2.3), AmiGo (§1.1–1.2) and Narayanan et al. (§3.7). Add stitch-type selection by curvature, and attachment edges for no-sew multi-part objects (§1.1).
- **Generative doilies: separate shape skeleton from motif layer.** Follow Knitting Skeletons (§3.12): a radial round structure and symmetry order, with lace-motif layers that resample. Use mathematically defined motifs (belcastro & Yackel §2.4) and hyperbolic constructions (Taimina §2.2) as both generators and regression tests.
- **ML features must emit graphs and be validated.** Neural Inverse Knitting (§3.11) works because knit output is a regular grid. Crochet is radial and irregular, so models should predict stitch graphs or round sequences. CrochetBench (§1.10) shows that structural validation, not text similarity, is the right measure.

---

## Unverified / could not confirm

These items were searched for and not confirmed well enough for the main text, or a detail is uncertain. Do not cite them as fact without checking.

1. **Guo et al. 2020 first author.** The CMU Textiles Lab page and the SIGGRAPH history archive list "Michelle Guo". Crossref metadata reportedly lists "Runbo Guo". A separate DOI, 10.1145/3388770.3407448 (OpenAlex), may be a SIGGRAPH 2020 poster or talk version. The SCF '20 ACM DL record used above is 10.1145/3424630.3425409. Confirm on the ACM DL which author name and DOI belong to which version.
2. **DOIs not confirmed by the search** for these sources, so links point to author or publisher pages:
   - Henderson & Taimina 2001. The guess 10.1007/BF03026623 was not confirmed.
   - Osinga & Krauskopf 2004. 10.1007/BF02985416 appears in a Wikipedia citation but was not confirmed from the publisher.
   - Kaldor et al. 2008. 10.1145/1360612.1360664 appeared only in a third-party reference list.
   - Kaldor et al. 2010. 10.1145/1778765.1778842 appeared only through a springerprofessional.de URL.
   - Yuksel et al. 2012.
   - Igarashi et al. 2008 (Knitting a 3D Model).
   - Efrati et al. 2009 (JMPS).
   - Sharon et al. 2002 (Nature).
3. **Whether JIS L 0201 covers crochet symbols.** The number, English title ("Letter Symbols for Knitting Stitch") and 1995 date are confirmed from a standards-store listing. Its Japanese title, whether it includes crochet (かぎ針編み) symbols, and specific glyph differences from the CYC set could not be confirmed. No authoritative CYC-vs-Japanese symbol comparison was found.
4. **Authors of "From Stitches to Digits and Back: Computational Crocheting of Branching Geometries"** (Eskişehir Technical University Journal of Science and Technology A, vol. 23, 2022, pp. 76–85; [DergiPark](https://dergipark.org.tr/en/pub/estubtda/article/1169938)). The paper exists and extends the 2017 Çapunaman et al. framework to branching, multi-part geometries made by several crafters. Its full author list was not confirmed. It is presumably Çapunaman and colleagues, but this is unconfirmed.
5. **"CT2Yarn: Yarn-Level Reconstruction of Crochet from Computed Tomography"** (arXiv [2609.06950](https://arxiv.org/abs/2609.06950)). The title and arXiv ID appear in search results. One search summary attributed it to Chang Luo and Nobuyuki Umetani at Pacific Graphics 2026, but a second search could not confirm those authors or that venue. Potentially relevant (yarn paths reconstructed from real crochet; stitch-pattern extraction). Check before citing.
6. **"Evaluating Physically Grounded Procedural Reasoning in VLMs through Real-World Execution: Crochet as a Testbed"** (arXiv [2611.10740](https://arxiv.org/abs/2611.10740)). The title is confirmed, the authors are not. A search summary attributed to it the claim that going from object to pattern has so far worked better than going from pattern to object, but this was not read in the paper.
7. **CrochetPARADE licence and repository.** Sources disagree on the licence (GPL-3.0 vs. CC BY-NC-SA, probably software vs. manual) and on the repository (Codeberg `crochetparade/CrochetPARADE` vs. GitHub `stassev/CrochetPARADE`). A standalone paper by Tassev was not found. CrochetBench cites "Tassev, 2025".
8. **Crochet Charts (Stitch Works Software).** The claims that it is GPL v3 since 1.2 and has source at `github.com/iPenguin/CrochetCharts` come from the user guide as reported in search results. The repository and the official `stitchworkssoftware.com` site were not opened directly. Platform and price details conflict between listings.
9. **A 2024 AAAI symposium study on LLM translation of crochet patterns into CrochetPARADE syntax.** It was referenced in a search result ([AAAI summer symposia preprint](https://summer-symposia-proceedings.aaai.org/preprints/pdfs/5499.pdf)). Its title and authors were not confirmed.
10. **"Neural inverse crochet" / ML crochet-from-mesh work, 2023–2026.** No peer-reviewed paper doing mesh -> crochet or image -> crochet with learned models was found, apart from the VLM benchmark work above. If one exists, it was not found.
11. **"Stitch Meshing" naming.** The prompt mentioned Wu et al. "Stitch meshing" and "Knittable stitch meshes". Both are confirmed (§3.4, §3.5). No separate crochet-specific Wu et al. paper was found.
12. **Network note.** Direct fetches to Crossref, DBLP and publisher pages were blocked in the research environment. All checks were done through web-search result metadata, so a DOI listed in the main text was confirmed by at least one bibliographic or publisher record surfaced by search, not by resolving it live. A quick pass resolving each DOI in a browser before publication is recommended.
