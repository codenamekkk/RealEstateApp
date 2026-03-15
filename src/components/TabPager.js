// TabPager.js – Native: uses PagerView for swipe navigation
import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import PagerView from "react-native-pager-view";

const TabPager = forwardRef(({ children, onPageSelected, style }, ref) => {
  const pagerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    setPage: (index) => pagerRef.current?.setPage(index),
  }));

  return (
    <PagerView
      ref={pagerRef}
      style={[{ flex: 1 }, style]}
      initialPage={0}
      onPageSelected={onPageSelected}
    >
      {children}
    </PagerView>
  );
});

export default TabPager;
