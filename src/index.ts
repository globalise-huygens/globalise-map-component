// @ts-ignore
import versor from "versor";
import {feature} from "topojson-client";
import {Topology, GeometryCollection} from "topojson-specification";
import {Feature, Point, LineString} from "geojson";
import {featureCollection, point, bezierSpline, lineString} from "@turf/turf";
import {zoom} from "d3-zoom";
import {D3DragEvent, drag} from "d3-drag";
import {select, pointer, pointers} from "d3-selection";
import {geoPath, geoOrthographic, GeoSphere} from "d3-geo";
import {transition} from "d3-transition";
import {interpolate} from "d3-interpolate";

import places from "../data/places.json" with {type: "json"};
import voyages from "../data/voyages.json" with {type: "json"};
import land110m from "../data/land-110m.json" with {type: "json"};
import land50m from "../data/land-50m.json" with {type: "json"};

type DragEvent = D3DragEvent<HTMLCanvasElement, unknown, unknown>;

const renderLowScale = () => render(false);
const renderAutoScale = () => render(true);

function render(useAutoScale: boolean) {
    const land = useAutoScale ? determineLandScale() : ftLand110m;
    popover.style.display = "none";

    context.reset();

    context.beginPath();
    path(sphere);
    context.fillStyle = "#fff";
    context.fill();

    context.beginPath();
    path(land);
    context.fillStyle = "#000";
    context.fill();

    context.beginPath();
    path(sphere);
    context.strokeStyle = "black";
    context.stroke();

    context.beginPath();
    path(placesGeoJSON);
    context.fillStyle = "grey";
    context.fill();

    if (activeVoyageMapping) {
        context.beginPath();
        path(bezierSpline(activeVoyageMapping));
        context.lineWidth = 3;
        context.strokeStyle = "grey";
        context.setLineDash([5, 3]);
        context.stroke();
    }

    if (activePlace) {
        context.beginPath();
        path(activePlace);
        context.fillStyle = "yellow";
        context.strokeStyle = "black";
        context.fill();
        context.stroke();
    }
}

function determineLandScale() {
    const scaleFactor = projection.scale() / scale;
    return scaleFactor < 2 ? ftLand110m : ftLand50m;
}

function handleDrag() {
    let v0: [number, number, number];
    let q0: [number, number, number];
    let r0: [number, number, number];
    let a0 = 0;

    function position(event: DragEvent, element: HTMLCanvasElement): [number, number] | [number, number, number] {
        const pts = pointers(event, element);
        if (pts.length === 1) {
            return pts[0];
        }

        const [p0, p1] = pts;
        const x = (p0[0] + p1[0]) / 2;
        const y = (p0[1] + p1[1]) / 2;
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);

        return [x, y, angle];
    }

    function dragStarted(this: HTMLCanvasElement, event: DragEvent) {
        const p = position(event, this);
        r0 = projection.rotate();
        v0 = versor.cartesian(projection.invert!([p[0], p[1]]));
        q0 = versor(r0);

        if (p.length === 3) {
            a0 = p[2];
        }
    }

    function dragged(this: HTMLCanvasElement, event: DragEvent) {
        const p = position(event, this);
        const v1 = versor.cartesian(projection.rotate(r0).invert!([p[0], p[1]]));
        const delta = versor.delta(v0, v1);

        let q1 = versor.multiply(q0, delta);
        if (p.length === 3) {
            const d = (p[2] - a0) / 2;
            const s = -Math.sin(d);
            const c = Math.sign(Math.cos(d));
            q1 = versor.multiply([Math.sqrt(1 - s * s), 0, 0, c * s], q1);
        }

        projection.rotate(versor.rotation(q1));
    }

    return drag<HTMLCanvasElement, unknown>()
        .on("start", dragStarted)
        .on("drag", dragged);
}

function handleHover(e: MouseEvent) {
    function showPopover(x: number, y: number, feature: Feature) {
        popover.style.left = `${x}px`;
        popover.style.top = `${y}px`;
        popover.textContent = feature.properties!._label;
        popover.style.display = "block";
    }

    const [mx, my] = pointer(e, canvas);

    let isHovering = false;
    for (const f of placesGeoJSON.features) {
        const coordinates = projection((f.geometry as Point).coordinates as [number, number]);
        if (!coordinates) continue;

        const dx = mx - coordinates[0];
        const dy = my - coordinates[1];
        if (dx * dx + dy * dy < 25) {
            isHovering = true;
            showPopover(coordinates[0], coordinates[1], f);
            break;
        }
    }

    if (!isHovering) {
        popover.style.display = "none";
    }
}

function rotateTo([lon, lat]: [number, number]) {
    transition()
        .duration(1000 * (projection.scale() / scale))
        .tween("rotate", () => {
            const r = interpolate(projection.rotate(), [-lon, -lat]);
            return t => {
                projection.rotate(r(t) as [number, number] | [number, number, number]);
                renderLowScale();
            };
        });
}

let activePlace: Feature<Point> | null = null;
let activeVoyage: Feature<LineString> | null = null;
let activeVoyageMapping: Feature<LineString> | null = null;

const placesGeoJSON = featureCollection(places.filter(place => place.geometry).map(place => {
    const {geometry, ...properties} = place;

    const match = geometry!.match(/^POINT\s*\(\s*(-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)\s*\)$/i);
    if (!match)
        throw new Error(`Invalid WKT: ${geometry}`);

    const lon = parseFloat(match[1]);
    const lat = parseFloat(match[3]);

    return point([lon, lat], properties);
}));

const placesContainer = document.getElementById('places-container') as HTMLDivElement;
for (const place of placesGeoJSON.features) {
    const card = document.createElement('div');
    card.className = 'card';
    placesContainer.appendChild(card);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = place.properties!._label;
    card.appendChild(label);

    if (place.properties!.alternative_labels.length > 0) {
        const altLabels = document.createElement('div');
        altLabels.className = 'alt-labels';

        for (const alternativeLabel of place.properties!.alternative_labels) {
            const altLabel = document.createElement('span');
            altLabel.className = 'alt-label';
            altLabel.textContent = alternativeLabel;
            altLabels.appendChild(altLabel);
        }

        card.appendChild(altLabels);
    }

    card.addEventListener('click', _ => {
        activePlace = place;
        for (const otherCard of placesContainer.getElementsByClassName('card')) {
            otherCard.classList.remove('active');
        }
        card.classList.add('active');
        rotateTo(place.geometry.coordinates as [number, number]);
    });
}

const voyagesStyle = document.getElementById('voyages-style') as HTMLInputElement;
voyagesStyle.addEventListener('change', _ => {
    if (voyagesStyle.checked) {
        activeVoyageMapping = activeVoyage;
    } else if (activeVoyage) {
        activeVoyageMapping = lineString(
            [activeVoyage.geometry.coordinates[0], activeVoyage.geometry.coordinates.reverse()[0]],
            activeVoyage.properties
        );
    }
    renderAutoScale();
});

const voyagesContainer = document.getElementById('voyages-container') as HTMLDivElement;
for (const voyage of voyages.features) {
    const card = document.createElement('div');
    card.className = 'card';
    voyagesContainer.appendChild(card);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${voyage.properties.from} ↔ ${voyage.properties.to}`;
    card.appendChild(label);

    card.addEventListener('click', _ => {
        activeVoyage = voyage as Feature<LineString>;
        activeVoyageMapping = voyage as Feature<LineString>;
        if (!voyagesStyle.checked) {
            activeVoyageMapping = lineString(
                [voyage.geometry.coordinates[0], voyage.geometry.coordinates.reverse()[0]],
                voyage.properties
            );
        }

        for (const otherCard of voyagesContainer.getElementsByClassName('card')) {
            otherCard.classList.remove('active');
        }
        card.classList.add('active');
        rotateTo(voyage.geometry.coordinates[0] as [number, number]);
    });
}


const ftLand110m = feature(land110m as unknown as Topology, land110m.objects.land as unknown as GeometryCollection);
const ftLand50m = feature(land50m as unknown as Topology, land50m.objects.land as unknown as GeometryCollection);

const popover = document.getElementById('popover') as HTMLDivElement;
const canvas = document.getElementById('map') as HTMLCanvasElement;
const context = canvas.getContext("2d")!;

const width = canvas.offsetWidth;
const height = width;
canvas.width = width;
canvas.height = height;

const sphere = {type: "Sphere"} as GeoSphere;
const projection = geoOrthographic()
    .fitExtent([[1, 1], [width - 1, height - 1]], sphere)
    .rotate([-110, 0]);
const scale = projection.scale();
const path = geoPath(projection, context).pointRadius(5);

select(canvas)
    .call(handleDrag()
        .on("drag.render", renderLowScale)
        .on("end.render", renderAutoScale))
    .call(zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([1, 8])
        .on("zoom", e => projection.scale(scale * e.transform.k))
        .on("zoom.render", renderLowScale)
        .on("end.render", renderAutoScale))
    .call(renderAutoScale)
    .node();

canvas.addEventListener("mousemove", handleHover);

// @ts-ignore
if (DEV) {
    new EventSource("/esbuild").addEventListener("change", () =>
        location.reload(),
    );
}
