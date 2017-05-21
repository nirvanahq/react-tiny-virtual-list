import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import debounce from 'lodash/debounce';
import SizeAndPositionManager from './SizeAndPositionManager';
import {
  ALIGN_CENTER,
  ALIGN_END,
  ALIGN_START,
  DIRECTION_VERTICAL,
  DIRECTION_HORIZONTAL,
  POSITION_ABSOLUTE,
  POSITION_RELATIVE,
  SCROLL_CHANGE_OBSERVED,
  SCROLL_CHANGE_REQUESTED,
  positionProp,
  scrollProp,
  sizeProp,
} from './constants';

const STYLE_WRAPPER = {overflow: 'auto', WebkitOverflowScrolling: 'touch'};
const STYLE_INNER = {position: POSITION_RELATIVE, willChange: 'transform', overflow: 'hidden', width: '100%', minHeight: '100%'};
const STYLE_CONTENT = {willChange: 'transform'};
const STYLE_CONTENT = {position: POSITION_RELATIVE, willChange: 'transform'};
const STYLE_ITEM = {position: POSITION_ABSOLUTE, left: 0, width: '100%'};

export default class VirtualList extends PureComponent {
  static defaultProps = {
    overscanCount: 3,
    scrollDirection: DIRECTION_VERTICAL,
    width: '100%',
    positionBehavior: POSITION_ABSOLUTE,
  };
  static propTypes = {
    estimatedItemSize: PropTypes.number,
    height: PropTypes.number.isRequired,
    itemCount: PropTypes.number.isRequired,
    itemSize: PropTypes.oneOfType([PropTypes.number, PropTypes.array, PropTypes.func]).isRequired,
    overscanCount: PropTypes.number,
    positionBehavior: PropTypes.oneOf([POSITION_ABSOLUTE, POSITION_RELATIVE]),
    renderItem: PropTypes.func.isRequired,
    scrollOffset: PropTypes.number,
    scrollToIndex: PropTypes.number,
    scrollToAlignment: PropTypes.oneOf([ALIGN_START, ALIGN_CENTER, ALIGN_END]),
    scrollDirection: PropTypes.oneOf([DIRECTION_HORIZONTAL, DIRECTION_VERTICAL]).isRequired,
    width: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }

  sizeAndPositionManager = new SizeAndPositionManager({
    itemCount: this.props.itemCount,
    itemSizeGetter: ({index}) => this.getSize(index),
    estimatedItemSize: this.getEstimatedItemSize(),
  });

  state = {
    offset: (
      this.props.scrollOffset ||
      this.props.scrollToIndex != null && this.getOffsetForIndex(this.props.scrollToIndex) ||
      0
    ),
    scrollChangeReason: SCROLL_CHANGE_REQUESTED,
  };

  _cellCache = {};
  _styleCache = {};

  _getRef = node => {
    this.rootNode = node;
  };

  componentDidMount() {
    const {scrollOffset, scrollToIndex} = this.props;

    if (scrollOffset != null) {
      this.scrollTo(scrollOffset);
    } else if (scrollToIndex != null) {
      this.scrollTo(this.getOffsetForIndex(scrollToIndex));
    }
  }

  componentWillReceiveProps(nextProps) {
    const {
      estimatedItemSize,
      itemCount,
      itemSize,
      scrollOffset,
      scrollToAlignment,
      scrollToIndex,
    } = this.props;
    const scrollPropsHaveChanged = (
      nextProps.scrollToIndex !== scrollToIndex ||
      nextProps.scrollToAlignment !== scrollToAlignment
    );
    const itemPropsHaveChanged = (
      nextProps.itemCount !== itemCount ||
      nextProps.itemSize !== itemSize ||
      nextProps.estimatedItemSize !== estimatedItemSize
    );

    if (
      nextProps.itemCount !== itemCount ||
      nextProps.estimatedItemSize !== estimatedItemSize
    ) {
      this.sizeAndPositionManager.updateConfig({
        itemCount: nextProps.itemCount,
        estimatedItemSize: this.getEstimatedItemSize(nextProps),
      });
    }

    if (itemPropsHaveChanged) {
      this.recomputeSizes();
    }

    if (nextProps.scrollOffset !== scrollOffset) {
      this.setState({
        offset: nextProps.scrollOffset,
        scrollChangeReason: SCROLL_CHANGE_REQUESTED,
      });
    } else if (
      scrollPropsHaveChanged ||
      nextProps.scrollToIndex && itemPropsHaveChanged
    ) {
      this.setState({
        offset: this.getOffsetForIndex(nextProps.scrollToIndex, nextProps.scrollToAlignment, nextProps.itemCount),
        scrollChangeReason: SCROLL_CHANGE_REQUESTED,
      });
    }
  }

  componentDidUpdate(nextProps, nextState) {
    const {offset} = this.state;

    if (nextState.offset !== offset && nextState.scrollChangeReason === SCROLL_CHANGE_REQUESTED) {
      this.scrollTo(offset);
    }
  }

  _lastOffset = 0;

  handleScroll = e => {
    const {onScroll} = this.props;
    const {isScrolling} = this.state;
    const offset = this.getNodeOffset();
    const {bottomEdge, topEdge} = this._nextRenderOffset;
    const direction = offset - this._lastOffset < 0
      ? 'up'
      : 'down';

    if (
      isScrolling && (
        offset < 0 ||
        this.state.offset === offset ||
        e.target !== this.rootNode ||
        direction === 'down' && offset < topEdge ||
        direction === 'up' && offset > bottomEdge
      )
    ) {
      // no-op
    } else {
      this.setState({
        isScrolling: true,
        offset,
        scrollChangeReason: SCROLL_CHANGE_OBSERVED,
      });

      if (typeof onScroll === 'function') {
        onScroll(offset, e);
      }

      this._lastOffset = offset;
    }

    this.onScrollEnd();
  };

  onScrollEnd = debounce(() => {
    this._cellCache = {};

    this.setState({
      isScrolling: false,
    });
  }, 150);

  getEstimatedItemSize(props = this.props) {
    return props.estimatedItemSize || typeof props.itemSize === "number" && props.itemSize || 50;
  }

  getNodeOffset() {
    const {scrollDirection} = this.props;
    return this.rootNode[scrollProp[scrollDirection]];
  }

  scrollTo(value) {
    const {scrollDirection} = this.props;
    this.rootNode[scrollProp[scrollDirection]] = value;
  }

  getOffsetForIndex(index, scrollToAlignment = this.props.scrollToAlignment, itemCount = this.props.itemCount) {
    const {scrollDirection} = this.props;

    if (index < 0) {
      index = 0;
    } else if (index >= itemCount) {
      index = itemCount - 1;
    }

    return this.sizeAndPositionManager.getUpdatedOffsetForIndex({
      align: scrollToAlignment,
      containerSize: this.props[sizeProp[scrollDirection]],
      targetIndex: index,
    });
  }

  getSize(index) {
    const {itemSize} = this.props;

    if (typeof itemSize === 'function') { return itemSize(index); }

    return Array.isArray(itemSize) ? itemSize[index] : itemSize;
  }

  getStyle(index) {
    const style = this._styleCache[index];
    if (style) { return style; }

    const {scrollDirection} = this.props;
    const {size, offset} = this.sizeAndPositionManager.getSizeAndPositionForIndex(index);

    return this._styleCache[index] = {
      ...STYLE_ITEM,
      [sizeProp[scrollDirection]]: size,
      [positionProp[scrollDirection]]: offset,
    };
  }

  recomputeSizes(startIndex = 0) {
    this._styleCache = {};
    this.sizeAndPositionManager.resetItem(startIndex);
  }

  render() {
    /* eslint-disable no-unused-vars */
    const {
      estimatedItemSize,
      height,
      overscanCount,
      renderItem,
      renderEmpty,
      itemCount,
      itemSize,
      positionBehavior,
      renderAfter,
      renderBefore,
      scrollDirection,
      scrollOffset,
      scrollToIndex,
      scrollToAlignment,
      style,
      width,
      ...props
    } = this.props;
    const {isScrolling, offset} = this.state;
    const {start, stop} = this.sizeAndPositionManager.getVisibleRange({
      containerSize: this.props[sizeProp[scrollDirection]],
      offset,
      overscanCount,
    });
    const isAbsolutePositioned = (positionBehavior === POSITION_ABSOLUTE);
    let items = [];

    for (let index = start; index <= stop; index++) {
      if (this._cellCache[index] == null) {
        this._cellCache[index] = renderItem({
          index,
          style: isAbsolutePositioned
            ? this.getStyle(index)
            : null,
        });
      }

      items.push(this._cellCache[index]);
    }

    const hasItems = items.length;

    if (hasItems) {
      this._nextRenderOffset = {
        bottomEdge: this.getOffsetForIndex(start + 1),
        topEdge: this.getOffsetForIndex(stop) - height,
      };
    } else if (typeof renderEmpty === 'function') {
      items = renderEmpty();
    }

    return (
      <div ref={this._getRef} {...props} onScroll={this.handleScroll} style={{...STYLE_WRAPPER, ...style, height, width}}>
        <div style={{...STYLE_INNER, [sizeProp[scrollDirection]]: this.sizeAndPositionManager.getTotalSize()}}>
          {renderBefore}
          {(isAbsolutePositioned || !hasItems)
            ? items
            : (
              <div style={{...STYLE_CONTENT, top: this.getOffsetForIndex(start)}}>
                {items}
              </div>
            )
          }
          {renderAfter}
        </div>
      </div>
    );
  }
}
