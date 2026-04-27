// Dimensiones globales del lienzo interno
const width = 800;
const height = 500;
const tooltip = d3.select("#tooltip");

// Parseador de fechas para el CSV
const parseDate = d3.timeParse("%d/%m/%Y");

// Variables globales para los filtros cruzados
let globalData = [];
let currentState = "All"; 
let currentMonthFilter = null;

// 1. CARGA DE DATOS
Promise.all([
    d3.csv("data_servicios.csv"),
    d3.json("https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json")
]).then(function(files) {
    globalData = files[0];
    let geoData = files[1];
    
    // 1. Puerto Rico rompe la proyección geoAlbersUsa, lo filtramos.
    geoData.features = geoData.features.filter(d => d.properties.name !== 'Puerto Rico');

    // 2. EL BUG DE VIRGINIA: Detectamos el estado y eliminamos el rectángulo gigante
    geoData.features.forEach(d => {
        if (d.properties.name === "Virginia" && d.geometry.type === "MultiPolygon") {
            // El recuadro falso tiene solo 5 puntos. Los polígonos reales tienen cientos.
            // Esto extirpa la figura defectuosa y deja el mapa intacto.
            d.geometry.coordinates = d.geometry.coordinates.filter(poly => poly[0].length > 10);
        }
    });

    // --- CAPA DE LIMPIEZA DE DATOS ---
    globalData.forEach(d => {
        if (d.State) d.State = d.State.trim();
        if (d.Sales) {
            d.Sales = parseFloat(d.Sales.toString().replace(/[^0-9.-]+/g,"")) || 0;
        } else {
            d.Sales = 0;
        }
        d.dateObj = parseDate(d["Order Date"]);
        d.Year = d.dateObj ? d.dateObj.getFullYear() : null; 
    });

    initDashboard(geoData);

}).catch(err => console.error("Error cargando los datos:", err));

function initDashboard(geoData) {
    // ---- AUTO-COMPLETAR FILTROS ----
    const years = Array.from(new Set(globalData.map(d => d.Year))).filter(y => y).sort();
    years.forEach(y => d3.select("#year-filter").append("option").attr("value", y).text(y));

    const statesList = Array.from(new Set(globalData.map(d => d.State))).filter(s => s).sort();
    // Ahora inyectamos <option> en el datalist (que no requiere atributo text)
    statesList.forEach(s => d3.select("#state-list").append("option").attr("value", s));

    // ---- CONFIGURACIÓN DE CONTENEDORES SVG ----
    
    // 1. Mapa Responsive
    const svgMap = d3.select("#map").append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`) 
        .style("width", "100%")
        .style("height", "auto"); 
    
    // fitSize ahora sí puede calcular el tamaño perfecto porque el recuadro gigante de Virginia ya no estorba
    const projection = d3.geoAlbersUsa().fitSize([width, height], geoData);
    const path = d3.geoPath().projection(projection);

    // 2. Gráfico de Barras
    const marginBar = {top: 20, right: 30, bottom: 40, left: 130}; 
    const barW = width - marginBar.left - marginBar.right;
    const barH = height - marginBar.top - marginBar.bottom;
    const svgBar = d3.select("#barchart").append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .style("width", "100%")
        .style("height", "auto")
        .append("g").attr("transform", `translate(${marginBar.left},${marginBar.top})`);
    const xBar = d3.scaleLinear().range([0, barW]);
    const yBar = d3.scaleBand().range([0, barH]).padding(0.2);
    const xAxisBar = svgBar.append("g").attr("transform", `translate(0,${barH})`);
    const yAxisBar = svgBar.append("g");

    // 3. Gráfico de Tendencias
    const marginTrend = {top: 20, right: 30, bottom: 30, left: 60};
    const trendW = width - marginTrend.left - marginTrend.right;
    const trendH = 250 - marginTrend.top - marginTrend.bottom; 
    const svgTrend = d3.select("#linechart").append("svg")
        .attr("viewBox", `0 0 ${width} 250`)
        .style("width", "100%")
        .style("height", "auto")
        .append("g").attr("transform", `translate(${marginTrend.left},${marginTrend.top})`);
    const xTrend = d3.scaleTime().range([0, trendW]);
    const yTrend = d3.scaleLinear().range([trendH, 0]);
    const xAxisTrend = svgTrend.append("g").attr("transform", `translate(0,${trendH})`);
    const yAxisTrend = svgTrend.append("g");
    const pathLine = svgTrend.append("path").attr("class", "line");
    const pathArea = svgTrend.append("path").attr("class", "area");

    // ---- FUNCIONES DE ACTUALIZACIÓN ----
    function updateMap(dataFilt) {
        let salesByState = d3.rollup(dataFilt, v => d3.sum(v, d => d.Sales), d => d.State);
        const maxSales = d3.max(Array.from(salesByState.values())) || 1;
        
        const colorScale = d3.scaleSqrt()
            .domain([0, maxSales])
            .range(["#1e3a8a", "#06b6d4"]); 
        
        const states = svgMap.selectAll(".state").data(geoData.features);
            
        states.enter().append("path")
            .attr("class", "state")
            .attr("d", path)
            .merge(states) 
            // CAMBIO: Usamos la variable para el borde
            .attr("stroke", "var(--map-stroke)") 
            .attr("stroke-width", 0.8)
            .classed("active-state", d => d.properties.name === currentState && currentState !== "All")
            .transition()
            .duration(800)
            .style("fill", function(d) {
                let stateSales = salesByState.get(d.properties.name) || 0;
                return stateSales > 0 ? colorScale(stateSales) : "var(--map-zero)"; 
            });

        svgMap.selectAll(".state")
            .on("mouseover", function(event, d) {
                let stateSales = salesByState.get(d.properties.name) || 0;
                tooltip.transition().duration(200).style("opacity", .95);
                tooltip.html(`<strong>${d.properties.name}</strong><br/>Ventas: $${stateSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
                    .style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => tooltip.transition().duration(500).style("opacity", 0))
            .on("click", function(event, d) {
                currentState = d.properties.name;
                d3.select("#state-filter").property("value", currentState);
                updateAllCharts();
            });
            
        updateLegend(colorScale, [0, maxSales]);
    }

    function updateLegend(colorScale, domainExtents) {
        d3.select("#map-legend").html("");
        if (!domainExtents || domainExtents[1] === 0) return;
        
        const legendDiv = d3.select("#map-legend");
        legendDiv.append("div").attr("class", "legend-title").style("font-size", "12px").style("color", "#94A3B8").style("margin-bottom", "5px").text("Volumen de Ventas");
        
        const colors = colorScale.range();
        legendDiv.append("div").style("width", "150px").style("height", "8px").style("border-radius", "4px").style("margin-bottom", "5px")
            .style("background", `linear-gradient(to right, ${colors[0]} 0%, ${colors[1]} 100%)`);
        
        const labels = legendDiv.append("div").style("display", "flex").style("justify-content", "space-between").style("font-size", "11px").style("color", "#E2E8F0");
        labels.append("span").text("$0");
        labels.append("span").text("$" + Math.round(domainExtents[1] / 1000) + "K");
    }

    function updateBar(dataFilt) {
        let salesBySubcat = d3.rollup(dataFilt, v => d3.sum(v, d => d.Sales), d => d['Sub-Category']);
        let barData = Array.from(salesBySubcat, ([key, value]) => ({key, value})).sort((a, b) => b.value - a.value).slice(0, 8);

        xBar.domain([0, d3.max(barData, d => d.value) || 0]);
        yBar.domain(barData.map(d => d.key));

        xAxisBar.transition().duration(1000).call(d3.axisBottom(xBar).ticks(5).tickFormat(d3.format("$,.0s")));
        yAxisBar.transition().duration(1000).call(d3.axisLeft(yBar));

        const bars = svgBar.selectAll(".bar").data(barData, d => d.key);
        bars.exit().transition().duration(500).attr("width", 0).remove();

        const barsEnter = bars.enter().append("rect").attr("class", "bar").attr("y", d => yBar(d.key)).attr("height", yBar.bandwidth()).attr("x", 0).attr("width", 0);
        barsEnter.merge(bars).transition().duration(1000).attr("y", d => yBar(d.key)).attr("height", yBar.bandwidth()).attr("width", d => xBar(d.value));

        barsEnter.merge(bars)
            .on("mouseover", function(event, d) {
                tooltip.transition().duration(200).style("opacity", .95);
                tooltip.html(`<strong>${d.key}</strong><br/>$${d.value.toLocaleString('en-US', {minimumFractionDigits: 2})}`)
                    .style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => tooltip.transition().duration(500).style("opacity", 0));
    }

    function updateTrend(dataFilt) {
        let validData = dataFilt.filter(d => d.dateObj != null);
        let trendData = d3.rollup(validData, v => d3.sum(v, d => d.Sales), d => d3.timeMonth(d.dateObj));
        let sortedData = Array.from(trendData, ([date, sales]) => ({date, sales})).sort((a, b) => a.date - b.date);

        if(sortedData.length === 0) {
            pathLine.attr("d", ""); pathArea.attr("d", "");
            return;
        }

        xTrend.domain(d3.extent(sortedData, d => d.date));
        yTrend.domain([0, d3.max(sortedData, d => d.sales) || 0]);

        xAxisTrend.transition().duration(1000).call(d3.axisBottom(xTrend).ticks(5));
        yAxisTrend.transition().duration(1000).call(d3.axisLeft(yTrend).ticks(5).tickFormat(d3.format("$,.0s")));

        const lineGen = d3.line().x(d => xTrend(d.date)).y(d => yTrend(d.sales)).curve(d3.curveMonotoneX);
        const areaGen = d3.area().x(d => xTrend(d.date)).y0(trendH).y1(d => yTrend(d.sales)).curve(d3.curveMonotoneX);

        pathLine.datum(sortedData).transition().duration(1000).attr("d", lineGen);
        pathArea.datum(sortedData).transition().duration(1000).attr("d", areaGen);

        // --- 1. DIBUJAR LÍNEA Y ÁREA PRIMERO (Al fondo) ---
        pathLine.datum(sortedData).transition().duration(1000).attr("d", lineGen);
        pathArea.datum(sortedData).transition().duration(1000).attr("d", areaGen);

        // --- 2. DIBUJAR PUNTOS AL FINAL (Al frente, para que detecten el mouse) ---
        // --- PUNTOS VISIBLES ---
        const dots = svgTrend.selectAll(".dot").data(sortedData);
        dots.exit().transition().duration(500).attr("r", 0).remove();
        
        const dotsEnter = dots.enter().append("circle")
            .attr("class", "dot")
            .attr("r", 0)
            .attr("fill", "#ec4899")
            .style("pointer-events", "none"); // El punto visible ignora el ratón

        const allDots = dotsEnter.merge(dots)
            .attr("cx", d => xTrend(d.date))
            .attr("cy", d => yTrend(d.sales));
            
        allDots.transition().duration(1000)
            .attr("r", d => currentMonthFilter && d.date.getTime() === currentMonthFilter.getTime() ? 8 : 4)
            .attr("fill", d => currentMonthFilter && d.date.getTime() === currentMonthFilter.getTime() ? "#fff" : "#ec4899");

        // --- ÁREAS DE CAPTURA INVISIBLES (HIT AREAS) ---
        const hitAreas = svgTrend.selectAll(".hit-area").data(sortedData);
        hitAreas.exit().remove();
        
        const hitAreasEnter = hitAreas.enter().append("circle")
            .attr("class", "hit-area")
            .attr("r", 15) // RADIO GIGANTE INVISIBLE
            .attr("fill", "transparent")
            .style("cursor", "pointer");

        hitAreasEnter.merge(hitAreas)
            .attr("cx", d => xTrend(d.date))
            .attr("cy", d => yTrend(d.sales))
            .on("mouseover", function(event, d) {
                // Al tocar lo invisible, agrandamos el punto visible correspondiente
                allDots.filter(dotData => dotData === d)
                       .transition().duration(100).attr("r", 8).attr("fill", "#f472b6");
                
                tooltip.transition().duration(200).style("opacity", .95);
                tooltip.html(`<strong>${d3.timeFormat("%B %Y")(d.date)}</strong><br/>Ventas: $${d.sales.toLocaleString('en-US', {minimumFractionDigits: 2})}<br/><span style="font-size: 10px; color: #cbd5e1;">(Clic para filtrar)</span>`)
                    .style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function(event, d) {
                // Regresar a la normalidad, excepto si está seleccionado
                const isSelected = currentMonthFilter && d.date.getTime() === currentMonthFilter.getTime();
                allDots.filter(dotData => dotData === d)
                       .transition().duration(300)
                       .attr("r", isSelected ? 8 : 4)
                       .attr("fill", isSelected ? "#fff" : "#ec4899");
                tooltip.transition().duration(500).style("opacity", 0);
            })
            .on("click", function(event, d) {
                // Lógica para filtrar al hacer clic en el punto
                if (currentMonthFilter && currentMonthFilter.getTime() === d.date.getTime()) {
                    currentMonthFilter = null; // Clic de nuevo para quitar filtro
                } else {
                    currentMonthFilter = d.date; // Aplicar filtro
                }
                updateAllCharts();
            });
    }

    // ---- ACTUALIZACIÓN DE INDICADORES (KPIs) ----
    function updateKPIs(dataFilt) {
        // 1. Cálculos Financieros Directos
        const totalSales = d3.sum(dataFilt, d => d.Sales);
        const totalOrders = dataFilt.length;
        const aov = totalOrders > 0 ? totalSales / totalOrders : 0;

        // Actualizamos los textos en el HTML con formato
        d3.select("#kpi-sales").text(totalSales > 0 ? "$" + d3.format(",.0f")(totalSales) : "$0");
        d3.select("#kpi-orders").text(d3.format(",")(totalOrders));
        d3.select("#kpi-aov").text(aov > 0 ? "$" + d3.format(",.2f")(aov) : "$0.00");

        // Función auxiliar para extraer al "ganador" (Top 1) de una agrupación
        function getTop1(rollupMap) {
            if(rollupMap.size === 0) return "-";
            // Convierte el mapa a un array, lo ordena de mayor a menor y saca el nombre del 1ro
            return Array.from(rollupMap).sort((a,b) => b[1] - a[1])[0][0];
        }

        // 2. Cálculos Categóricos (Agrupaciones)
        
        // Estado con más ventas de dinero
        let salesByState = d3.rollup(dataFilt, v => d3.sum(v, d => d.Sales), d => d.State);
        d3.select("#kpi-state").text(getTop1(salesByState));

        // Categoría con más ventas de dinero
        let salesByCat = d3.rollup(dataFilt, v => d3.sum(v, d => d.Sales), d => d.Category);
        d3.select("#kpi-category").text(getTop1(salesByCat));

        // Sub-Categoría con más ventas de dinero
        let salesBySub = d3.rollup(dataFilt, v => d3.sum(v, d => d.Sales), d => d['Sub-Category']);
        d3.select("#kpi-subcategory").text(getTop1(salesBySub));

        // Segmento con más transacciones (frecuencia)
        let ordersBySegment = d3.rollup(dataFilt, v => v.length, d => d.Segment);
        d3.select("#kpi-segment").text(getTop1(ordersBySegment));

        // Envío más frecuente (frecuencia)
        let ordersByShip = d3.rollup(dataFilt, v => v.length, d => d['Ship Mode']);
        let topShip = getTop1(ordersByShip);
        // Limpiamos el texto para que quepa mejor en la tarjeta (ej: "Standard Class" -> "Standard")
        if (topShip !== "-") topShip = topShip.replace(" Class", "");
        d3.select("#kpi-ship").text(topShip);
    }

    // ---- LÓGICA MAESTRA DE FILTRADO CRUZADO ----
    function updateAllCharts() {
        let category = d3.select("#category-filter").property("value");
        let year = d3.select("#year-filter").property("value");
        
        let baseData = globalData;

        // Filtros Globales Superiores
        if (category !== "All") baseData = baseData.filter(d => d.Category === category);
        if (year !== "All") baseData = baseData.filter(d => d.Year.toString() === year);
        
        // NUEVO: Filtro por Mes desde la gráfica de tendencia
        if (currentMonthFilter !== null) {
            baseData = baseData.filter(d => 
                d.dateObj && 
                d.dateObj.getMonth() === currentMonthFilter.getMonth() && 
                d.dateObj.getFullYear() === currentMonthFilter.getFullYear()
            );
        }

        updateMap(baseData);

        let stateFilteredData = baseData;
        if (currentState !== "All" && currentState !== "") {
            stateFilteredData = baseData.filter(d => d.State === currentState);
            d3.select("#bar-title").text(`Top Sub-Categorías (${currentState})`);
            d3.select("#trend-title").text(`Tendencia de Ventas (${currentState})`);
        } else {
            d3.select("#bar-title").text(`Top Sub-Categorías (Nacional)`);
            d3.select("#trend-title").text(`Tendencia de Ventas (Nacional)`);
        }

        updateBar(stateFilteredData);
        updateTrend(stateFilteredData);
        updateKPIs(stateFilteredData); 
    }

    // ---- LISTENERS ----
    // ---- LISTENERS REFINADOS ----
    
    // Al cambiar Categoría o Año, limpiamos el filtro del mes
    d3.select("#category-filter").on("change", function() {
        currentMonthFilter = null; 
        updateAllCharts();
    });
    
    d3.select("#year-filter").on("change", function() {
        currentMonthFilter = null; 
        updateAllCharts();
    });
    
    // Al escribir/buscar un estado
    d3.select("#state-filter").on("input", function() {
        currentState = d3.select(this).property("value");
        if (currentState === "" || statesList.includes(currentState)) {
            if(currentState === "") currentState = "All";
            currentMonthFilter = null; // Soltamos el punto temporal
            updateAllCharts();
        }
    });

    // Al hacer doble clic en el mapa
    d3.select("#map").on("dblclick", function() {
        currentState = "All";
        currentMonthFilter = null; // Soltamos el punto temporal
        d3.select("#state-filter").property("value", ""); 
        updateAllCharts();
    });

    // Botón de Reinicio (Se mantiene igual)
    d3.select("#reset-btn").on("click", function() {
        currentState = "All";
        currentMonthFilter = null;
        d3.select("#category-filter").property("value", "All");
        d3.select("#year-filter").property("value", "All");
        d3.select("#state-filter").property("value", ""); 
        updateAllCharts();
    });

    // Carga inicial
    updateAllCharts();
}

// ---- LÓGICA DEL MODO CLARO / OSCURO ----
const themeBtn = document.getElementById("theme-toggle");
themeBtn.addEventListener("click", () => {
    // Apuntamos al elemento raíz de la página (<html>)
    const rootElement = document.documentElement;
    
    // Si ya está en modo claro, lo quitamos (vuelve al oscuro por defecto)
    if (rootElement.getAttribute("data-theme") === "light") {
        rootElement.removeAttribute("data-theme");
        themeBtn.textContent = "☀️"; // Cambiamos el icono
    } else {
        // Si es oscuro, le ponemos el atributo del modo claro
        rootElement.setAttribute("data-theme", "light");
        themeBtn.textContent = "🌙"; 
    }
});