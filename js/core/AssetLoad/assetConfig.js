// Key paths for the 3D models to be loaded
export const MODEL_MANIFEST = {
  mario: "assets/models/Super_Mario/Main_Characters/MarioGLTF/mario.gltf",
  luigi: "assets/models/Super_Mario/Main_Characters/LuigiGLTF/Luigi.gltf",
  yoshi: "assets/models/Super_Mario/Main_Characters/YoshiGLTF/yoshi.gltf",
};

export function initGameModels(assetLoader) {
  return assetLoader.loadAll(MODEL_MANIFEST);
}