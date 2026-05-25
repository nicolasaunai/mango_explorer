import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);

  const camera = new THREE.PerspectiveCamera(45,
    container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(30, 20, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x0066cc, wireframe: true })
  ));
  scene.add(new THREE.AxesHelper(8));

  function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  scene.userData = { camera, renderer };
  return { scene, camera, controls, renderer };
}
