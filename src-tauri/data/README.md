# data

`cities.csv` — GeoNames populated places (`lat,lon,name,admin1,admin2,cc`;
names ASCII-folded, 144,563 rows, CRLF), as shipped by the `reverse_geocoder`
4.1.1 crate. Data © [GeoNames](https://www.geonames.org/), CC BY 4.0;
attribution is shown in Settings → about. Embedded by `src/geocode.rs` for
offline reverse labels and city search.
