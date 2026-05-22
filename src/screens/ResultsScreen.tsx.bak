import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import RNFS from 'react-native-fs';
import type { RootStackParamList } from '../types';

type Props = StackScreenProps<RootStackParamList, 'Results'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CELL_SIZE = SCREEN_WIDTH / 4;
const TOTAL_EXPECTED = 20;

export const ResultsScreen = ({ route, navigation }: Props) => {
  const { images } = route.params;

  // ── State ──────────────────────────────────────────────────────────────────
  const [verifiedImages, setVerifiedImages] = useState<(string | null)[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [displayCount, setDisplayCount] = useState<number>(0);
  const [showToast, setShowToast] = useState<boolean>(false);

  // ── Animated Values ────────────────────────────────────────────────────────
  const countAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const fadeAnims = useRef(
    Array.from({ length: 20 }, () => new Animated.Value(0)),
  ).current;

  // ── Data Loading & Verification ────────────────────────────────────────────
  useEffect(() => {
    const verifyFiles = async () => {
      setIsLoading(true);

      const verified: (string | null)[] = [];
      for (const path of images) {
        try {
          const cleanPath = path.replace('file://', '');
          const exists = await RNFS.exists(cleanPath);
          verified.push(exists ? path : null);
        } catch (error) {
          console.warn('[ResultsScreen] Failed to verify file:', path, error);
          verified.push(null);
        }
      }

      setVerifiedImages(verified);
      setIsLoading(false);
    };

    verifyFiles();
  }, [images]);

  // ── Counter Animation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;

    // Animate counter from 0 to 20
    Animated.timing(countAnim, {
      toValue: 20,
      duration: 800,
      useNativeDriver: false,
    }).start();

    const listenerId = countAnim.addListener(({ value }) => {
      setDisplayCount(Math.round(value));
    });

    return () => {
      countAnim.removeListener(listenerId);
    };
  }, [isLoading, countAnim]);

  // ── Staggered Fade-In Animation ────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;

    fadeAnims.forEach((anim, index) => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 400,
        delay: index * 30,
        useNativeDriver: true,
      }).start();
    });
  }, [isLoading, fadeAnims]);

  // ── Scan Again Handler ─────────────────────────────────────────────────────
  const handleScanAgain = async () => {
    // Delete all saved marker files
    for (const path of images) {
      try {
        const cleanPath = path.replace('file://', '');
        await RNFS.unlink(cleanPath);
      } catch (error) {
        console.warn('[ResultsScreen] Failed to delete file:', path, error);
      }
    }

    // Reset navigation stack
    navigation.reset({
      index: 0,
      routes: [{ name: 'Camera' }],
    });
  };

  // ── Save All Handler (Toast) ───────────────────────────────────────────────
  const handleSaveAll = () => {
    setShowToast(true);

    Animated.sequence([
      // Fade in
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      // Wait
      Animated.delay(1500),
      // Fade out
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowToast(false);
    });
  };

  // ── Render Item ────────────────────────────────────────────────────────────
  const renderItem = ({
    item,
    index,
  }: {
    item: string | null;
    index: number;
  }) => {
    const hasValidUri = item != null && item.length > 0;

    return (
      <Animated.View
        style={[styles.cellContainer, { opacity: fadeAnims[index] }]}>
        {hasValidUri ? (
          <Image
            source={{ uri: item }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>?</Text>
          </View>
        )}
      </Animated.View>
    );
  };

  // ── Loading State ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000" />
          <Text style={styles.loadingText}>Loading captured markers...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  const validCount = verifiedImages.filter(Boolean).length;

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <Text style={styles.header}>
        Captured Markers ({displayCount}/{TOTAL_EXPECTED})
      </Text>
      <Text style={styles.subtitle}>
        Captured: {validCount} of {TOTAL_EXPECTED}
      </Text>

      {/* Image Grid */}
      <FlatList
        data={verifiedImages}
        keyExtractor={(_, index) => index.toString()}
        numColumns={4}
        renderItem={renderItem}
        contentContainerStyle={styles.gridContent}
        style={styles.grid}
      />

      {/* Bottom Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.scanAgainButton}
          onPress={handleScanAgain}>
          <Text style={styles.scanAgainText}>Scan Again</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveAllButton} onPress={handleSaveAll}>
          <Text style={styles.saveAllText}>Save All</Text>
        </TouchableOpacity>
      </View>

      {/* Toast Message */}
      {showToast && (
        <Animated.View
          style={[styles.toastContainer, { opacity: toastAnim }]}>
          <Text style={styles.toastText}>Feature coming soon</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },

  // ── Loading ─────────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },

  // ── Grid ────────────────────────────────────────────────────────────────────
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingBottom: 160,
  },
  cellContainer: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  image: {
    width: 300,
    height: 300,
  },

  // ── Placeholder ─────────────────────────────────────────────────────────────
  placeholder: {
    flex: 1,
    backgroundColor: '#cccccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 32,
    color: '#888',
    fontWeight: 'bold',
  },

  // ── Actions ─────────────────────────────────────────────────────────────────
  actionsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingTop: 8,
  },
  scanAgainButton: {
    marginHorizontal: 16,
    height: 56,
    backgroundColor: '#000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  scanAgainText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  saveAllButton: {
    marginHorizontal: 16,
    height: 56,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  saveAllText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Toast ───────────────────────────────────────────────────────────────────
  toastContainer: {
    position: 'absolute',
    bottom: 180,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 8,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
