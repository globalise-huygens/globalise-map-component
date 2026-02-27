// @ts-ignore
import versor from "versor";
import {feature} from "topojson-client";
import {FeatureCollection, Feature, Point} from "geojson";
import {D3DragEvent, drag} from "d3-drag";
import {select, pointer, pointers} from "d3-selection";
import {geoPath, geoOrthographic, GeoSphere} from "d3-geo";

import places from "../data/places.json" with {type: "json"};
import world from "../data/land-110m.json" with {type: "json"};

type DragEvent = D3DragEvent<HTMLCanvasElement, unknown, unknown>;

function render() {
    context.clearRect(0, 0, width, height);

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
    context.stroke();

    context.beginPath();
    path(placesGeoJSON);
    context.fillStyle = "grey";
    context.fill();
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

const placesGeoJSON: FeatureCollection = {
    type: "FeatureCollection",
    features: places.filter(place => place.geometry).map(place => {
        const {geometry, ...properties} = place;

        const match = geometry!.match(/^POINT\s*\(\s*(-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)\s*\)$/i);
        if (!match)
            throw new Error(`Invalid WKT: ${geometry}`);

        const lon = parseFloat(match[1]);
        const lat = parseFloat(match[3]);

        return {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [lon, lat],
            },
            properties
        };
    })
};

// @ts-ignore
const land = feature(world, world.objects.land);

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
const path = geoPath(projection, context).pointRadius(5);

select(canvas)
    .call(handleDrag().on("drag.render", render))
    .call(render)
    .node();

canvas.addEventListener("mousemove", handleHover);

// @ts-ignore
if (DEV) {
    new EventSource("/esbuild").addEventListener("change", () =>
        location.reload(),
    );
}
