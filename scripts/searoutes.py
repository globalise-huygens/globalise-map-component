import re
import json
import random
import searoute as sr

NUM_VOYAGES = 50

places = []
with open('../data/places.json') as f:
    for item in json.load(f):
        geom = item.get('geometry', '')
        if geom:
            m = re.match(r'POINT\(([+-]?\d+\.?\d*)\s+([+-]?\d+\.?\d*)\)', geom.strip())
            lon, lat = float(m.group(1)), float(m.group(2))

            places.append({
                'label': item.get('_label'),
                'lon': lon,
                'lat': lat,
            })

features = []
for i in range(NUM_VOYAGES):
    origin, dest = random.sample(places, 2)
    feature = sr.searoute([origin['lon'], origin['lat']], [dest['lon'], dest['lat']])

    feature['geometry']['coordinates'].insert(0, [origin['lon'], origin['lat']])
    feature['geometry']['coordinates'].append([dest['lon'], dest['lat']])

    feature['properties']['from'] = origin['label']
    feature['properties']['to'] = dest['label']

    features.append(feature)

with open('../data/voyages.json', 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': features}, f, indent=2)
