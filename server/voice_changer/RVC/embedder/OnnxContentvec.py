import onnxruntime
import torch
from voice_changer.RVC.deviceManager.DeviceManager import DeviceManager
from voice_changer.RVC.embedder.Embedder import Embedder


class OnnxContentvec(Embedder):
    # content_vec_500.onnx takes 16 kHz audio [1, n] and has one output per feature layout:
    # layer 9 through final_proj (256 dims, RVC v1) and layer 12 as is (768 dims, RVC v2).
    OUTPUTS = {(9, True): "units9", (12, False): "unit12"}

    def loadModel(self, file: str, dev: torch.device) -> Embedder:
        gpu = dev.index if dev.type == "cuda" and dev.index is not None else -1
        providers, providerOptions = DeviceManager.get_instance().getOnnxExecutionProvider(gpu)
        self.onnxSession = onnxruntime.InferenceSession(file, providers=providers, provider_options=providerOptions)
        super().setProps("hubert_base", file, dev, False)
        return self

    def extractFeatures(
        self, feats: torch.Tensor, embOutputLayer=9, useFinalProj=True
    ) -> torch.Tensor:
        output = self.OUTPUTS.get((embOutputLayer, useFinalProj))
        if output is None:
            raise Exception(f"content_vec_500.onnx has no output for layer {embOutputLayer} (final_proj={useFinalProj})")
        audio = feats.detach().float().cpu().numpy()
        units = self.onnxSession.run([output], {"audio": audio})[0]
        return torch.as_tensor(units, dtype=torch.float32, device=self.dev)

    # Nothing to cast or move: onnxruntime owns the model.
    def setHalf(self, isHalf: bool):
        self.isHalf = False

    def setDevice(self, dev: torch.device):
        self.dev = dev
        return self
