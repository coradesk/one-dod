import sys, torch, torch.nn as nn, torch.nn.functional as F
class SRVGGNetCompact(nn.Module):
    def __init__(s, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__(); s.upscale=upscale
        s.body = nn.ModuleList([nn.Conv2d(num_in_ch, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)])
        for _ in range(num_conv):
            s.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1)); s.body.append(nn.PReLU(num_parameters=num_feat))
        s.body.append(nn.Conv2d(num_feat, num_out_ch*upscale*upscale, 3, 1, 1))
        s.upsampler = nn.PixelShuffle(upscale)
    def forward(s, x):
        out = x
        for m in s.body: out = m(out)
        out = s.upsampler(out)
        return out + F.interpolate(x, scale_factor=s.upscale, mode='nearest')
m = SRVGGNetCompact()
sd = torch.load(sys.argv[1], map_location='cpu', weights_only=True)
sd = sd.get('params_ema', sd.get('params', sd))
m.load_state_dict(sd, strict=True); m.eval()
x = torch.rand(1,3,64,64)
torch.onnx.export(m, x, sys.argv[2], input_names=['input'], output_names=['output'], opset_version=17,
    dynamic_axes={'input':{2:'h',3:'w'},'output':{2:'h4',3:'w4'}}, dynamo=False)
print("ok")
