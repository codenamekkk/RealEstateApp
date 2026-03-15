// TabPager.web.js – Web: simple tab switching (no swipe)
import React, { forwardRef, useImperativeHandle, useState } from "react";
import { View } from "react-native";

const TabPager = forwardRef(({ children, onPageSelected, style }, ref) => {
  const [page, setPage] = useState(0);
  const childArray = React.Children.toArray(children);

  useImperativeHandle(ref, () => ({
    setPage: (index) => {
      setPage(index);
      onPageSelected?.({ nativeEvent: { position: index } });
    },
  }));

  return (
    <View style={[{ flex: 1 }, style]}>
      {childArray[page]}
    </View>
  );
});

export default TabPager;
