import "./helpers/cartogram";

const {
  _globals: globals,
  utils,
  helpers: {
    labels: Labels,
    "d3.geoProjection": d3GeoProjection,
    topojson,
    "d3.dynamicBackground": DynamicBackground, 
  },
  iconset: {
    warn: iconWarn,
    question: iconQuestion,
  },
} = Vizabi;


// BUBBLE MAP CHART COMPONENT
const CartogramComponent = Vizabi.Component.extend("cartogram", {
  /**
   * Initializes the component (Bubble Map Chart).
   * Executed once before any template is rendered.
   * @param {Object} config The config passed to the component
   * @param {Object} context The component's parent
   */
  init(config, context) {
    this.name = "cartogram";
    this.template = require("./template.html");


    this.isMobile = utils.isMobileOrTablet();

    //define expected models for this component
    this.model_expects = [{
      name: "time",
      type: "time"
    }, {
      name: "entities",
      type: "entities"
    }, {
      name: "marker",
      type: "model"
    }, {
      name: "locale",
      type: "locale"
    }, {
      name: "ui",
      type: "ui"
    }];

    const _this = this;
    this.model_binds = {
      "change:time.value": function(evt) {
        if (!_this._readyOnce) return;
        if (!_this.calculationQueue) { // collect timestamp that we request
          _this.calculationQueue = [_this.model.time.value.toString()];
        } else {
          _this.calculationQueue.push(_this.model.time.value.toString());
        }
        (function(time) { // isolate timestamp
          _this.model.marker.getFrame(time, (frame, time) => {
            const index = _this.calculationQueue.indexOf(time.toString()); //
          if (index == -1) { // we was receive more recent frame before so we pass this frame
            return;
          }
          _this.calculationQueue.splice(0, index + 1); // remove timestamps that added to queue before current timestamp
          _this.frameChanged(frame, time);
        });

        })(_this.model.time.value);
      },
      "change:marker.size.extent": function(evt, path) {
        //console.log("EVENT change:marker:size:max");
        if (!_this._readyOnce) return;
        _this.updateMarkerSizeLimits();
        _this.updateEntities();
      },
      "change:marker.color.scaleType": function(evt, path) {
        _this.updateIndicators();
        _this.updateEntitityColor();
      },

      "change:marker.size.use": function(evt, path) {
        _this.model.ui.chart.lockActive = _this.model.marker.size.use != "constant";
      },
      "change:marker.color.palette": function(evt, path) {
        _this.updateEntitityColor();
      },
      "change:ui.chart.lockNonSelected": function(evt) {
        _this.updateEntities(900);
      },
      "change:marker.select": function() {
        if (!_this._readyOnce) return;
        _this.updateLandOpacity();
      },
      "change:marker.highlight": function() {
        if (!_this._readyOnce) return;
        //console.log("EVENT change:entities:highlight");
        _this.updateLandOpacity();
      },
      "change:marker.opacitySelectDim": function() {
        _this.updateLandOpacity();
      },
      "change:marker.opacityRegular": function() {
        _this.updateLandOpacity();
      },
    };
    //this._selectlist = new Selectlist(this);

    //contructor is the same as any component
    this._super(config, context);


    _this.COLOR_LAND_DEFAULT = "#fdfdfd";

    this.mapLands = null;
    this.features = null;
    this.topo_features = null;
    this.borderArcs = null;
    this.defaultWidth = 700;
    this.defaultHeight = 550;
    this.updateEntitiesQueue = [];
    d3GeoProjection();
    this.cached = [];

    const projection = "geo" + utils.capitalize(this.model.ui.map.projection);

    this.zeroProjection = d3[projection]()
      .scale(1)
      .translate([0, 0]);

    this.projection = d3[projection]()
      .scale(1)
      .translate([0, 0]);

    this.mapPath = d3.geoPath()
      .projection(this.projection);

    this.cartogram = d3.cartogram()
        .projection(this.projection)
        .properties(d => d.properties);

    this._labels = new Labels(this);
    this._labels.config({
      CSS_PREFIX: "vzb-ct",
      LABELS_CONTAINER_CLASS: "vzb-ct-labels",
      LINES_CONTAINER_CLASS: "vzb-ct-lines"
    });

  },

  afterPreload() {
    const _this = this;
    if (!this.world) utils.warn("cartogram afterPreload: missing country shapes " + this.world);
    if (!this.geometries) utils.warn("cartogram afterPreload: missing country shapes " + this.geometries);
  },
  _getKey(d) {
    return d.properties[this.model.ui.map.topology.geoIdProperty] &&
      this.mapKeys[d.properties[this.model.ui.map.topology.geoIdProperty]] ?
        this.mapKeys[d.properties[this.model.ui.map.topology.geoIdProperty]].toString() : 
        d.id.toString();
  },
  /**
   * DOM is ready
   */
  readyOnce() {
    const _this = this;
    this.element = d3.select(this.element);

    this.graph = this.element.select(".vzb-ct-graph");
    this.mapSvg = this.element.select(".vzb-ct-map-background");

    this.labelsContainerCrop = this.graph.select(".vzb-ct-labels-crop");
    this.labelsContainer = this.graph.select(".vzb-ct-labels");

    this.sTitleEl = this.graph.select(".vzb-ct-axis-s-title");
    this.cTitleEl = this.graph.select(".vzb-ct-axis-c-title");

    this.sInfoEl = this.graph.select(".vzb-ct-axis-s-info");
    this.cInfoEl = this.graph.select(".vzb-ct-axis-c-info");

    this.dataWarningEl = this.graph.select(".vzb-data-warning");
    this.entityBubbles = null;
    this.tooltip = this.element.select(".vzb-ct-tooltip");

    // year background
    this.yearEl = this.graph.select(".vzb-ct-year");
    this.year = new DynamicBackground(this.yearEl);
    this.year.setConditions({ xAlign: "left", yAlign: "bottom", bottomOffset: 5 });

    this.mapGraph = this.element.select(".vzb-ct-map-graph")
      .attr("width", this.defaultWidth)
      .attr("height", this.defaultHeight);
    this.mapGraph.html("");

    this.showAreas();
    this.KEY = this.model.entities.getDimension();
    this.TIMEDIM = this.model.time.getDimension();

    this.updateUIStrings();
    this.on("resize", () => this.updateSize());
    this.wScale = d3.scaleLinear()
      .domain(this.model.ui.datawarning.doubtDomain)
      .range(this.model.ui.datawarning.doubtRange);

/*
*/
  },
  
  
  frameChanged(frame, time) {
    if (time.toString() != this.model.time.value.toString()) return; // frame is outdated
    if (!frame) return;
    this.values = frame;
    this.updateTime();
    this.updateTitleNumbers();
    this.updateEntities(this.duration);
  },

  /*
   * Both model and DOM are ready
   */
  ready() {
    const _this = this;
    this.cached = [];
    this.updateIndicators();
    this.updateUIStrings();
    this.updateMarkerSizeLimits();
    this.updateSize();
    this.model.marker.getFrame(_this.model.time.value, (frame, time) => {
      _this.mapKeys = Object.keys(frame.hook_map)
        .reduce((obj, key) => {
          obj[frame.hook_map[key]] = key;
          return obj;
        }, {});
      _this.frameChanged(frame, time)
    });
  },

  showAreas() {
    const _this = this;
    this.cartogram.iterations(0);
    this.redrawInProgress = true;

    this.cartogram(this.shapes, this.geometries).then(response => {
      _this.redrawInProgress = false;

      _this.features = _this.topo_features = response.features;
      _this.mapLands = _this.mapGraph.selectAll(".land")
        .data(_this.topo_features)
        .enter().append("path")
        .attr("class", d => "land " + (d.properties[_this.model.ui.map.topology.geoIdProperty] ?
          d.properties[_this.model.ui.map.topology.geoIdProperty] :
          d.id))
        .attr("d", _this.cartogram.path)
        .on("mouseover", (d, i) => {
          if (utils.isTouchDevice()) return;
          _this._interact()._mouseover(d, i);
        })
        .on("mouseout", (d, i) => {
          if (utils.isTouchDevice()) return;
          _this._interact()._mouseout(d, i);
        })
        .on("click", (d, i) => {
          if (utils.isTouchDevice()) return;
          _this._interact()._click(d, i);
        })
        .each(d => {
          d[_this.KEY] = _this._getKey(d);
        });
      if (_this.borderArcs) {
        const data = _this.cartogram.stitchArcs(response, _this.borderArcs);
        _this.borders = _this.mapGraph.append("path")
          .datum(data)
          .attr("class", "boundary")
          .attr("d", _this.cartogram.path);
      }
    });
  },

  /**
   * Changes labels for indicators
   */
  updateIndicators() {
    this.sScale = this.model.marker.size.getScale();
    this.cScale = this.model.marker.color.getScale();
  },

  updateMarkerSizeLimits() {
    const _this = this;
    const extent = this.model.marker.size.extent || [0, 1];
    this.minRadius = Math.max(100 * extent[0], 0);
    this.maxRadius = Math.max(100 * extent[1], 0);

    this.sScale.domain([0, this.sScale.domain()[1]]);
    if (this.model.marker.size.scaleType !== "ordinal") {
      this.sScale.range([this.minRadius, this.maxRadius]);
    } else {
      this.sScale.rangePoints([this.minRadius, this.maxRadius], 0).range();
    }
  },

  _redrawEntities() {
    const _this = this;
    if (this.updateEntitiesQueue.length == 0) return;
    if (this.redrawInProgress) {
      setTimeout(() => {
        _this._redrawEntities();
    }, 100);
      return;
    }
    this.redrawInProgress = true;
    let time = this.updateEntitiesQueue[this.updateEntitiesQueue.length - 1].time;
    let duration = this.updateEntitiesQueue[this.updateEntitiesQueue.length - 1].duration;
    this.updateEntitiesQueue = [];
    if (this.model.ui.chart.lockNonSelected) {
      time = this.model.time.parse("" + this.model.ui.chart.lockNonSelected);
    }
    this.model.marker.getFrame(time, lockedFrame => {
      const totValue = null;
    if (_this.model.marker.size.use == "constant") {
      _this.cartogram.iterations(0);
    } else {
      _this.cartogram.iterations(8);
      //var areas = _this.topo_features.map(d3.geo.path().projection(null).area);
      _this.cartogram.value(d => {
        if (_this.model.ui.chart.lockNonSelected) {
          const size1 = _this.sScale(lockedFrame.size[_this._getKey(d)]);
          const size2 = _this.sScale(_this.values.size[_this._getKey(d)]);
          return d3.geo.path().projection(null).area(d) * Math.pow((size2 / size1), 2);
        }
        return _this.sScale(_this.values.size[_this._getKey(d)]);
      });
    }
    const start = new Date().getTime();
    _this.cartogram(_this.shapes, _this.geometries, totValue).then(response => {
      const end = new Date().getTime();
      if (duration) { // increale duration for prevent gaps between frames
        duration = Math.max(duration, end - start);
      }
      _this.features = response.features;
      if (_this.borderArcs) {
        const data = _this.cartogram.stitchArcs(response, _this.borderArcs);
        _this.borders.datum(data)
          .transition()
          .duration(duration)
          .ease(d3.easeLinear)
          .attr("d", _this.cartogram.path);
      }
    _this.mapLands.data(_this.features)
      .each(d => {
      d[_this.KEY] = _this._getKey(d);
  });
      if (duration) {
        _this.mapLands.interrupt()
          .transition()
          .duration(duration)
          .ease(d3.easeLinear)
          .style("fill", d => _this.values.color[_this._getKey(d)] != null ? _this.cScale(_this.values.color[_this._getKey(d)]) : _this.COLOR_LAND_DEFAULT)
          .attr("d", _this.cartogram.path);
        if (_this.borderArcs) {
          _this.borders.interrupt()
            .transition()
            .duration(duration)
            .ease(d3.easeLinear)
            .attr("d", _this.cartogram.path);
        }
      } else {
        _this.borders
          .attr("d", _this.cartogram.path);
  
        _this.mapLands
          .style("fill", d => _this.values.color[_this._getKey(d)] != null ? _this.cScale(_this.values.color[_this._getKey(d)]) : _this.COLOR_LAND_DEFAULT)
          .attr("d", _this.cartogram.path);
      }
      _this.updateLandOpacity();
      _this.redrawInProgress = false;
      _this._redrawEntities();
    });
  });
  },

  updateEntities(duration) {
    const time = this.model.time.value;

    this.updateEntitiesQueue.push({ time, duration });
    this._redrawEntities();
  },

  updateEntitityColor() {
    const _this = this;
    this.mapLands.transition()
      .duration(_this.duration)
      .ease(d3.easeLinear)
      .style("fill", d => _this.values.color[_this._getKey(d)] != null ? _this.cScale(_this.values.color[_this._getKey(d)]) : _this.COLOR_LAND_DEFAULT);

  },
  updateUIStrings() {
    const _this = this;

    this.translator = this.model.locale.getTFunction();

    const conceptPropsS = _this.model.marker.size.getConceptprops();
    const conceptPropsC = _this.model.marker.color.getConceptprops();

    this.strings = {
      title: {
        S: conceptPropsS.name,
        C: conceptPropsC.name
      }
    };

    this.sTitleEl.select("text")
      .text(this.translator("buttons/size") + ": " + this.strings.title.S)
      .on("click", () => {
        _this.parent
          .findChildByName("gapminder-treemenu")
          .markerID("size")
          .alignX(_this.model.locale.isRTL() ? "right" : "left")
          .alignY("top")
          .updateView()
          .toggle();
      });

    this.cTitleEl.select("text")
      .text(this.translator("buttons/color") + ": " + this.strings.title.C)
      .on("click", () => {
        _this.parent
          .findChildByName("gapminder-treemenu")
          .markerID("color")
          .alignX(_this.model.locale.isRTL() ? "right" : "left")
          .alignY("top")
          .updateView()
          .toggle();
      });

    utils.setIcon(this.dataWarningEl, iconWarn).select("svg").attr("width", "0px").attr("height", "0px");
    this.dataWarningEl.append("text")
      .attr("text-anchor", "end")
      .text(this.translator("hints/dataWarning"));

    this.dataWarningEl
      .on("click", () => {
        _this.parent.findChildByName("gapminder-datawarning").toggle();
      })
      .on("mouseover", () => {
        _this.updateDoubtOpacity(1);
      })
      .on("mouseout", () => {
        _this.updateDoubtOpacity();
      });

    this.sInfoEl
      .html(iconQuestion)
      .select("svg").attr("width", "0px").attr("height", "0px");

    //TODO: move away from UI strings, maybe to ready or ready once
    this.sInfoEl.on("click", () => {
      _this.parent.findChildByName("gapminder-datanotes").pin();
    });
    this.sInfoEl.on("mouseover", function() {
      const rect = this.getBBox();
      const coord = utils.makeAbsoluteContext(this, this.farthestViewportElement)(rect.x - 10, rect.y + rect.height + 10);
      const toolRect = _this.root.element.getBoundingClientRect();
      const chartRect = _this.element.node().getBoundingClientRect();
      _this.parent.findChildByName("gapminder-datanotes").setHook("size").show().setPos(coord.x + chartRect.left - toolRect.left, coord.y);
    });
    this.sInfoEl.on("mouseout", () => {
      _this.parent.findChildByName("gapminder-datanotes").hide();
    });

    this.cInfoEl
      .html(iconQuestion)
      .select("svg").attr("width", "0px").attr("height", "0px");

    //TODO: move away from UI strings, maybe to ready or ready once
    this.cInfoEl.on("click", () => {
      _this.parent.findChildByName("gapminder-datanotes").pin();
    });
    this.cInfoEl.on("mouseover", function() {
      const rect = this.getBBox();
      const coord = utils.makeAbsoluteContext(this, this.farthestViewportElement)(rect.x - 10, rect.y + rect.height + 10);
      const toolRect = _this.root.element.getBoundingClientRect();
      const chartRect = _this.element.node().getBoundingClientRect();
      _this.parent.findChildByName("gapminder-datanotes").setHook("color").show().setPos(coord.x + chartRect.left - toolRect.left, coord.y);
    });
    this.cInfoEl.on("mouseout", () => {
      _this.parent.findChildByName("gapminder-datanotes").hide();
    });
  },

  updateDoubtOpacity(opacity) {
    if (opacity == null) opacity = this.wScale(+this.time.getUTCFullYear().toString());
    if (this.someSelected) opacity = 1;
    this.dataWarningEl.style("opacity", opacity);
  },

  /*
   * UPDATE TIME:
   * Ideally should only update when time or data changes
   */
  updateTime() {
    const _this = this;
    this.time_1 = this.time == null ? this.model.time.value : this.time;
    this.time = this.model.time.value;
    this.duration = this.model.time.playing && (this.time - this.time_1 > 0) ? this.model.time.delayAnimations : 0;
    this.year.setText(this.model.time.formatDate(this.time), this.duration);
  },


  /**
   * Executes everytime the container or vizabi is resized
   * Ideally,it contains only operations related to size
   */
  updateSize() {
    const profiles = {
      small: {
        margin: { top: 10, right: 10, left: 10, bottom: 0 },
        infoElHeight: 16,
      },
      medium: {
        margin: { top: 20, right: 20, left: 20, bottom: 30 },
        infoElHeight: 20,
      },
      large: {
        margin: { top: 30, right: 30, left: 30, bottom: 35 },
        infoElHeight: 22,
      }
    };

    const presentationProfileChanges = {
      medium: {
        infoElHeight: 26
      },
      large: {
        infoElHeight: 32
      }
    };

    this.activeProfile = this.getActiveProfile(profiles, presentationProfileChanges);
    const { margin } = this.activeProfile;
    const { infoElHeight } = this.activeProfile;

    //stage
    const height = this.height = (parseInt(this.element.style("height"), 10) - margin.top - margin.bottom) || 0;
    const width = this.width = (parseInt(this.element.style("width"), 10) - margin.left - margin.right) || 0;

    if (this.height <= 0 || this.width <= 0) return utils.warn("Bubble map updateSize() abort: vizabi container is too little or has display:none");


    let scaleDelta = 1, mapTopOffset = 0, mapLeftOffset = 0;
    const currentNW = this.zeroProjection([
      this.model.ui.map.bounds.west,
      this.model.ui.map.bounds.north
    ]);
    const currentSE = this.zeroProjection([
      this.model.ui.map.bounds.east,
      this.model.ui.map.bounds.south
    ]);
    const canvas = [
      [0, 0],
      [width, height]
    ];
    if (this.model.ui.map.preserveAspectRatio) {
      mapTopOffset =  margin.top;
      mapLeftOffset =  margin.left;
      const scaleX = Math.abs((canvas[1][0] - canvas[0][0]) / (currentSE[0] - currentNW[0]));
      const scaleY = Math.abs((canvas[1][1] - canvas[0][1]) / (currentSE[1] - currentNW[1]));
      if (scaleX != scaleY) {
        if (scaleX > scaleY) {
          scaleDelta = scaleY;
          mapLeftOffset += (Math.abs(canvas[1][0] - canvas[0][0]) - Math.abs(scaleDelta * (currentNW[1] - currentSE[1]))) / 2;
        } else {
          scaleDelta = scaleX;
          mapTopOffset += (Math.abs(canvas[1][1] - canvas[0][1]) - Math.abs(scaleDelta * (currentNW[0] - currentSE[0]))) / 2;
        }
      }
    } else {
      scaleDelta = Math.abs((canvas[1][0] - canvas[0][0]) / (currentSE[0] - currentNW[0]));
    }

    this.graph
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    this.year.resize(this.width, this.height);

    this.mapSvg
      .attr("width", width)
      .attr("height", height)
      .attr("preserveAspectRatio", "xMidYMid")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .style("transform", "translate3d(" + margin.left + "px," + margin.top + "px,0)");

    this.projection
      .translate([canvas[0][0] - (currentNW[0] * scaleDelta) + mapLeftOffset - margin.left, canvas[0][1] - (currentNW[1] * scaleDelta) + mapTopOffset - margin.top])
      .scale(scaleDelta)
      .precision(0.1);
    this.cartogram.projection(this.projection);
    this.updateEntities();

    this.year.setConditions({
      widthRatio: 2 / 10
    });
    this.year.resize(this.width, this.height);
    
    this.cTitleEl
      .style("font-size", infoElHeight)
      .attr("transform", "translate(0," + margin.top + ")");

    const cTitleBB = this.cTitleEl.select("text").node().getBBox();

    this.sTitleEl.attr("transform", "translate(" + 0 + "," + (margin.top + cTitleBB.height) + ")")
      .classed("vzb-hidden", this.model.marker.size.use == "constant");

    const warnBB = this.dataWarningEl.select("text").node().getBBox();
    this.dataWarningEl.select("svg")
      .attr("width", warnBB.height * 0.75)
      .attr("height", warnBB.height * 0.75)
      .attr("x", -warnBB.width - warnBB.height * 1.2)
      .attr("y", -warnBB.height * 0.65);

    this.dataWarningEl
      .attr("transform", "translate(" + (this.width) + "," + (this.height - warnBB.height * 0.5) + ")")
      .select("text");

    if (this.sInfoEl.select("svg").node()) {
      const titleBBox = this.sTitleEl.node().getBBox();
      const translate = [0, 0];//d3.transform(this.yTitleEl.attr("transform")).translate;

      this.sInfoEl.select("svg")
        .attr("width", infoElHeight)
        .attr("height", infoElHeight);
      this.sInfoEl.attr("transform", "translate("
        + (titleBBox.x + translate[0] + titleBBox.width + infoElHeight * 0.4) + ","
        + (translate[1] - infoElHeight * 0.8) + ")");
    }

    this.cInfoEl.classed("vzb-hidden", this.cTitleEl.classed("vzb-hidden"));

    if (!this.cInfoEl.classed("vzb-hidden") && this.cInfoEl.select("svg").node()) {
      const titleBBox = this.cTitleEl.node().getBBox();
      const translate = [0, 0];//d3.transform(this.sTitleEl.attr("transform")).translate;

      this.cInfoEl.select("svg")
        .attr("width", infoElHeight)
        .attr("height", infoElHeight);
      this.cInfoEl.attr("transform", "translate("
        + (titleBBox.x + translate[0] + titleBBox.width + infoElHeight * 0.4) + ","
        + (translate[1] - infoElHeight * 0.8) + ")");
    }
  },

  fitSizeOfTitles() {

    //reset font sizes first to make the measurement consistent
    const cTitleText = this.cTitleEl.select("text")
      .style("font-size", null);
    const sTitleText = this.sTitleEl.select("text")
      .style("font-size", null);


    const cTitleBB = cTitleText.node().getBBox();
    const sTitleBB = this.sTitleEl.classed("vzb-hidden") ? cTitleBB : sTitleText.node().getBBox();

    const font =
      Math.max(parseInt(cTitleText.style("font-size")), parseInt(sTitleText.style("font-size")))
      * this.width / Math.max(cTitleBB.width, sTitleBB.width);

    if (Math.max(cTitleBB.width, sTitleBB.width) > this.width) {
      cTitleText.style("font-size", font + "px");
      sTitleText.style("font-size", font + "px");
    } else {
      // Else - reset the font size to default so it won't get stuck
      cTitleText.style("font-size", null);
      sTitleText.style("font-size", null);
    }
  },
  _interact() {
    const _this = this;

    return {
      _mouseover(d, i) {
        if (_this.model.time.dragging) return;

        _this.model.marker.highlightMarker(d);

        _this.hovered = d;
        //put the exact value in the size title
        _this.updateTitleNumbers();
        _this.fitSizeOfTitles();

        if (_this.model.marker.isSelected(d)) { // if selected, not show hover tooltip
          _this._setTooltip();
        } else {
          //position tooltip
          _this._setTooltip(d);
        }
      },
      _mouseout(d, i) {
        if (_this.model.time.dragging) return;
        _this._setTooltip();
        _this.hovered = null;
        _this.updateTitleNumbers();
        _this.fitSizeOfTitles();
        _this.model.marker.clearHighlighted();
      },
      _click(d, i) {
        _this.model.marker.selectMarker(d);
      }
    };

  },

  // show size number on title when hovered on a bubble
  updateTitleNumbers() {
    const _this = this;

    let mobile; // if is mobile device and only one bubble is selected, update the ytitle for the bubble
    if (_this.isMobile && _this.model.marker.select && _this.model.marker.select.length === 1) {
      mobile = _this.model.marker.select[0];
    }

    if (_this.hovered || mobile) {
      const hovered = _this.hovered || mobile;
      const formatterC = _this.model.marker.color.getTickFormatter();

      let unitC = _this.translator("unit/" + _this.model.marker.color.which);
      //suppress unit strings that found no translation (returns same thing as requested)
      if (unitC === "unit/" + _this.model.marker.color.which) unitC = "";

      const valueC = _this.values.color[_this._getKey(hovered)];
      _this.cTitleEl.select("text")
        .text(this.strings.title.C + ": " +
          (valueC || valueC === 0 ? formatterC(valueC) + " " + unitC : _this.translator("hints/nodata")));

      if (this.model.marker.size.use !== "constant") {
        const formatterS = _this.model.marker.size.getTickFormatter();

        let unitS = _this.translator("unit/" + _this.model.marker.size.which);
        //suppress unit strings that found no translation (returns same thing as requested)
        if (unitS === "unit/" + _this.model.marker.size.which) unitS = "";

        const valueS = _this.values.size[_this._getKey(hovered)];
        _this.sTitleEl.select("text")
          .text(this.strings.title.S + ": " + formatterS(valueS) + " " + unitS);
      }

      this.cInfoEl.classed("vzb-hidden", true);
      this.sInfoEl.classed("vzb-hidden", true);
    } else {
      this.cTitleEl.select("text")
        .text(this.strings.title.C);
      this.sTitleEl.select("text")
        .text(this.strings.title.S);

      this.cInfoEl.classed("vzb-hidden", false);
      this.sInfoEl.classed("vzb-hidden", false);
    }
  },

  _setTooltip(d) {
    const _this = this;
    if (d) {
      const tooltipText = this.values.label[this._getKey(d)] ?
        this.values.label[this._getKey(d)]
        : d.properties.MN_NAME;
      const offset = 10;
      const mouse = d3.mouse(this.graph.node()).map(d => parseInt(d));
      let x = mouse[0];
      let y = mouse[1];
      let xPos, yPos, xSign = -1,
        ySign = -1,
        xOffset = 0,
        yOffset = 0;

      if (offset) {
        xOffset = offset * 0.71; // .71 - sin and cos for 315
        yOffset = offset * 0.71;
      }
      //position tooltip
      this.tooltip.classed("vzb-hidden", false)
      //.attr("style", "left:" + (mouse[0] + 50) + "px;top:" + (mouse[1] + 50) + "px")
        .selectAll("text")
        .text(tooltipText);

      const contentBBox = this.tooltip.select("text").node().getBBox();
      if (x - xOffset - contentBBox.width < 0) {
        xSign = 1;
        x += contentBBox.width + 5; // corrective to the block Radius and text padding
      } else {
        x -= 5; // corrective to the block Radius and text padding
      }
      if (y - yOffset - contentBBox.height < 0) {
        ySign = 1;
        y += contentBBox.height;
      } else {
        y -= 11; // corrective to the block Radius and text padding
      }
      if (offset) {
        xPos = x + xOffset * xSign;
        yPos = y + yOffset * ySign; // 5 and 11 - corrective to the block Radius and text padding
      } else {
        xPos = x + xOffset * xSign; // .71 - sin and cos for 315
        yPos = y + yOffset * ySign; // 5 and 11 - corrective to the block Radius and text padding
      }
      this.tooltip.attr("transform", "translate(" + (xPos ? xPos : mouse[0]) + "," + (yPos ? yPos : mouse[1]) +
        ")");

      this.tooltip.select("rect").attr("width", contentBBox.width + 8)
        .attr("height", contentBBox.height * 1.2)
        .attr("x", -contentBBox.width - 4)
        .attr("y", -contentBBox.height * 0.85)
        .attr("rx", contentBBox.height * 0.2)
        .attr("ry", contentBBox.height * 0.2);


    } else {

      this.tooltip.classed("vzb-hidden", true);
    }
  },

  updateLandOpacity() {
    const _this = this;
    //if(!duration)duration = 0;

    const OPACITY_HIGHLT = 0.8;
    const OPACITY_HIGHLT_DIM = 0.3;
    const OPACITY_SELECT = 1.0;
    const OPACITY_REGULAR = this.model.marker.opacityRegular;
    const OPACITY_SELECT_DIM = this.model.marker.opacitySelectDim;
    this.someHighlighted = (this.model.marker.highlight.length > 0);
    this.someSelected = (this.model.marker.select.length > 0);
    this.mapLands
      .style("opacity", d => {

      if (_this.someHighlighted) {
      //highlight or non-highlight
      if (_this.model.marker.isHighlighted(d)) return OPACITY_HIGHLT;
    }

    if (_this.someSelected) {
      //selected or non-selected
      return _this.model.marker.isSelected(d) ? OPACITY_SELECT : OPACITY_SELECT_DIM;
    }

    if (_this.someHighlighted) return OPACITY_HIGHLT_DIM;

    return OPACITY_REGULAR;
  });


    const someSelectedAndOpacityZero = _this.someSelected && _this.model.marker.opacitySelectDim < 0.01;

    // when pointer events need update...
    if (someSelectedAndOpacityZero != this.someSelectedAndOpacityZero_1) {
      this.mapLands.style("pointer-events", d => (!someSelectedAndOpacityZero || _this.model.marker.isSelected(d)) ?
        "visible" : "none");
    }

    this.someSelectedAndOpacityZero_1 = _this.someSelected && _this.model.marker.opacitySelectDim < 0.01;
  },

  preload() {
    const _this = this;
    const shape_path = this.model.ui.map.topology.path 
      || (this.model.data.assetsPath + "world-50m.json");    

    const projection = "geo" + utils.capitalize(this.model.ui.map.projection);

    this.zeroProjection = d3[projection]();
    this.zeroProjection
      .scale(1)
      .translate([0, 0]);

    this.projection = d3[projection]();
    this.projection
      .scale(1)
      .translate([0, 0]);

    this.mapPath = d3.geoPath()
      .projection(this.projection);

    this.model.ui.map.scale = 1;
    return this._loadShapes(shape_path).then(
        shapes => {
        _this.shapes = shapes;
        _this.geometries = _this.shapes.objects[_this.model.ui.map.topology.objects.boundaries].geometries;
        _this.mapFeature = topojson.feature(_this.shapes, _this.shapes.objects[_this.model.ui.map.topology.objects.geo]);
        _this.mapBounds = _this.mapPath.bounds(_this.mapFeature);
        _this.boundaries = topojson.mesh(_this.shapes, _this.shapes.objects[_this.model.ui.map.topology.objects.boundaries], (a, b) => a !== b);
        _this.borderArcs = _this.cartogram.meshArcs(_this.shapes, _this.shapes.objects[_this.model.ui.map.topology.objects.boundaries], (a, b) => {
          a.properties[_this.model.ui.map.topology.geoIdProperty] && 
          a.properties[_this.model.ui.map.topology.geoIdProperty] !== b.properties[_this.model.ui.map.topology.geoIdProperty]
        });
      }
    );
  },
  
  _loadShapes(shape_path) {
    return new Promise((resolve, reject) => {
      d3.json(shape_path, (error, json) => {
        if (error) return console.warn("Failed loading json " + shape_path + ". " + error);
        resolve(json);
      });
    });
  }
});


export default CartogramComponent;
