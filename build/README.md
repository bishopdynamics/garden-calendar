# Building the data

The page is static: `index.html` loads `data.js` (crops), `engine.js` (planting rules) and `geo/*.js`
(locations + climate). Everything in this folder regenerates those files.

```sh
# 1. Crop list + photos -> data.js, images/   (edit build/crops.py, then:)
python3 build/build.py

# 2. Location + climate data -> geo/zips.js, geo/places.js, geo/stations.js
#    (only needed if the source datasets change; downloads ~90 MB into build/raw/, which is git-ignored)
cd build/raw
curl -O https://prism.oregonstate.edu/phzm/data/2023/phzm_us_zipcode_2023.csv
curl -O https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
curl -O https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip
curl -O https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/cities/totals/sub-est2023.csv
curl -O https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz
curl -O https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_monthly_multivariate_by-station_c20230404.tar.gz
mkdir -p ann mly
tar xzf us-climate-normals_*annualseasonal*.tar.gz -C ann
tar xzf us-climate-normals_*monthly_multivariate*.tar.gz -C mly
cd ../.. && python3 build/geo.py

# 3. Check the engine
node build/test/check.js            # Claremont vs. hand-made reference + sample cities
node build/test/check.js 55401      # every crop for one ZIP
node build/test/sweep.js 400        # anomaly sweep across 400 ZIPs
```

`build/test/claremont_reference.json` is the original hand-curated Claremont calendar, kept as a
regression reference for tuning crop rules.
