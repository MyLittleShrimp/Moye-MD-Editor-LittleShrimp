"""Render the Moye launch film from actual UI captures. No network is used.

Requires Pillow, NumPy and FFmpeg (or imageio-ffmpeg). Optional: --preview.
Font overrides: MOYE_FONT_REGULAR / MOYE_FONT_BOLD / MOYE_FONT_LIGHT.
"""
from pathlib import Path
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import wave
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/media'
IMAGES = ROOT / 'docs/images'
WORK = ROOT / '.build/media'
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
W, H, FPS, DURATION = 1920, 1080, 30, 42
GREEN = (66, 96, 71)
INK = (38, 53, 44)
MUTED = (108, 121, 110)
CREAM = (247, 246, 239)
LIGHT = (225, 233, 217)
FONT_PATHS = {
    'regular': os.environ.get('MOYE_FONT_REGULAR', 'C:/Windows/Fonts/msyh.ttc'),
    'bold': os.environ.get('MOYE_FONT_BOLD', 'C:/Windows/Fonts/msyhbd.ttc'),
    'light': os.environ.get('MOYE_FONT_LIGHT', 'C:/Windows/Fonts/msyhl.ttc'),
}

@lru_cache(maxsize=80)
def font(size, weight='regular'):
    return ImageFont.truetype(FONT_PATHS[weight], size)

def text(im, xy, value, size=32, color=INK, weight='regular', spacing=12):
    ImageDraw.Draw(im).multiline_text(xy, value, font=font(size, weight), fill=color, spacing=spacing, stroke_width=0)

def ease(value):
    x = max(0, min(1, value))
    return 1 - (1-x)**3

def background(dark=False):
    y, x = np.mgrid[0:H, 0:W]
    if dark:
        base, spot = np.array([27, 40, 33]), np.array([25, 37, 23])
    else:
        base, spot = np.array([249, 248, 242]), np.array([-22, -18, -28])
    glow = np.exp(-((x-1570)**2/(2*850**2) + (y-660)**2/(2*610**2)))
    return Image.fromarray(np.clip(base + glow[..., None]*spot, 0, 255).astype(np.uint8))

BG_LIGHT, BG_DARK = background(), background(True)
sources = {}
for name in ['editor-light', 'editor-dark', 'preview', 'context-menu', 'rename']:
    sources[name] = Image.open(IMAGES / (name+'.png')).convert('RGB')
for name in ['welcome', 'paste-before', 'paste-after', 'focus']:
    sources[name] = Image.open(WORK / (name+'.png')).convert('RGB')

@lru_cache(maxsize=80)
def panel(name, width):
    source = sources[name]
    height = round(source.height * width / source.width)
    screenshot = source.resize((width, height), Image.Resampling.LANCZOS).convert('RGBA')
    mask = Image.new('L', (width, height))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width-1, height-1), 18, fill=255)
    screenshot.putalpha(mask)
    tile = Image.new('RGBA', (width+100, height+120))
    shadow = Image.new('RGBA', tile.size)
    ImageDraw.Draw(shadow).rounded_rectangle((50, 63, width+50, height+63), 18, fill=(24, 40, 28, 60))
    tile.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))
    tile.alpha_composite(screenshot, (50, 40))
    return tile

def put_panel(im, name, x, y, width, alpha=1):
    tile = panel(name, width)
    if alpha < 1:
        tile = tile.copy()
        tile.putalpha(tile.getchannel('A').point(lambda p: round(p * max(0, alpha))))
    im.paste(tile, (round(x)-50, round(y)-40), tile)

def brand(im, x=96, y=65, dark=False, scale=1):
    d = ImageDraw.Draw(im)
    s = round(58*scale)
    fill = LIGHT if dark else GREEN
    fg = GREEN if dark else CREAM
    d.rounded_rectangle((x, y, x+s, y+s), round(17*scale), fill=fill)
    # A deterministic line mark matching the app's feather identity.
    pts = [(x+17*scale,y+43*scale),(x+43*scale,y+15*scale)]
    d.line(pts, fill=fg, width=max(2,round(2.5*scale)))
    d.arc((x+15*scale,y+10*scale,x+47*scale,y+43*scale), 180, 370, fill=fg, width=max(2,round(2.5*scale)))
    d.line([(x+25*scale,y+35*scale),(x+25*scale,y+24*scale)], fill=fg, width=max(2,round(2*scale)))
    text(im,(x+s+18*scale,y-5*scale),'墨页',round(32*scale),LIGHT if dark else INK,'bold')
    text(im,(x+s+19*scale,y+36*scale),'M O Y E',round(13*scale),LIGHT if dark else MUTED)

def pill(im, xy, label, dark=False):
    x,y = xy
    width = round(ImageDraw.Draw(im).textlength(label, font=font(23)))+42
    ImageDraw.Draw(im).rounded_rectangle((x,y,x+width,y+48), 24, fill=(59,78,62) if dark else (226,234,219))
    text(im,(x+21,y+7),label,23,LIGHT if dark else GREEN)
    return width

SCENES = [
    (0,5,'intro'), (5,12,'files'), (12,19,'preview'), (19,26,'menu'),
    (26,32,'paste'), (32,38,'dark'), (38,42,'outro'),
]

def frame_scene(index, t):
    start,end,kind = SCENES[index]
    local = t-start
    dark = kind in ['dark','outro']
    im = (BG_DARK if dark else BG_LIGHT).copy()
    d = ImageDraw.Draw(im)
    fg,muted = (LIGHT,(166,186,168)) if dark else (INK,MUTED)
    offset = round(32*(1-ease(local/0.85)))
    if kind == 'intro':
        brand(im,130,132,scale=1.15)
        text(im,(132,302+offset),'留一点空间，\n给文字。',100,INK,'bold',spacing=14)
        text(im,(138,585+offset),'本地 Markdown 编辑器',34,GREEN)
        text(im,(139,652+offset),'打开  ·  落笔  ·  保存',27,MUTED)
        put_panel(im,'editor-light',985,263-12*ease(local/3),810)
        pill(im,(140,777),'Windows x64')
        pill(im,(361,777),'无需账户')
        text(im,(140,984),'MOYE  /  SIMPLE WORDS, YOUR OWN FILES',19,MUTED)
    elif kind == 'outro':
        brand(im,803,185,dark=True,scale=1.6)
        text(im,(385,399+offset),'让想法，留在你的文件里。',79,LIGHT,'bold')
        text(im,(715,542+offset),'少一些打扰，多一些书写。',35,(171,193,172))
        labels = ['本地文件','离线使用','专注书写']
        x=692
        for label in labels:
            x += pill(im,(x,673),label,True)+20
        text(im,(703,873),'墨页 MOYE  ·  Windows Markdown 编辑器',23,(174,193,175))
        text(im,(833,924),'Apache-2.0  /  v1.1.0',20,(135,160,140))
    else:
        brand(im,dark=dark)
        text(im,(1602,83),'MOYE  /  1.1.0',21,muted)
        copy = {
            'files': ('01  /  LOCAL FILES','文件在哪，\n就在哪写。','打开、编辑、保存、另存为。\n直接读写你选择的本地文件。','无需导入资料库'),
            'preview': ('02  /  LIVE PREVIEW','左边落笔，\n右边成文。','Markdown 实时预览。\n大纲、清单、表格，清晰呈现。','编辑 / 双栏 / 预览'),
            'menu': ('03  /  EVERYDAY TOOLS','常用操作，\n一次右键。','剪切、复制、粘贴、撤销。\n点击文件名，轻松重命名。','右键菜单 · F2 重命名'),
            'paste': ('04  /  SMART PASTE','复制过来，\n格式也留下。','保留剪贴板中的标题与列表。\n也支持按原样粘贴。','Ctrl V / Ctrl Shift V'),
            'dark': ('05  /  YOUR WRITING SPACE','换个主题，\n继续专注。','深浅主题随心切换。\n只在本地，安心书写。','离线使用 · 专注模式'),
        }[kind]
        text(im,(96,259+offset),copy[0],20,muted)
        text(im,(90,323+offset),copy[1],64,fg,'bold',spacing=17)
        text(im,(97,546+offset),copy[2],25,muted,spacing=19)
        pill(im,(97,678+offset),copy[3],dark)
        if kind == 'files': before,after,change = 'welcome','editor-light',2.0
        elif kind == 'preview': before,after,change = 'editor-light','preview',3.6
        elif kind == 'menu': before,after,change = 'context-menu','rename',3.7
        elif kind == 'paste': before,after,change = 'paste-before','paste-after',0.9
        else: before,after,change = 'editor-dark','focus',4.1
        x = 587+24*(1-ease(local/1.2))
        y = 204-8*ease(local/(end-start))
        mix = max(0,min(1,(local-change)/0.5))
        if mix < 1: put_panel(im,before,x,y,1240)
        if mix > 0: put_panel(im,after,x,y,1240,mix)
        if kind == 'paste': text(im,(97,772),'* 来源需包含文字或可识别的格式',18,muted)
        text(im,(98,982),'墨页 · 把注意力还给文字',21,muted)
        d.line((96,1023,1824,1023), fill=(62,82,66) if dark else (221,226,215), width=2)
        d.line((96,1023,96+round(1728*t/DURATION),1023), fill=(177,203,165) if dark else GREEN,width=3)
    return im

def frame(t):
    index = next((i for i,(start,end,_) in enumerate(SCENES) if start<=t<end),len(SCENES)-1)
    result = frame_scene(index,t)
    start = SCENES[index][0]
    if index and t-start<0.42:
        result = Image.blend(frame_scene(index-1,start-0.001),result,ease((t-start)/0.42))
    if t<0.5: result = Image.blend(BG_LIGHT,result,ease(t/0.5))
    if t>DURATION-0.8: result = Image.blend(result,BG_DARK,(t-(DURATION-0.8))/0.8)
    return result

def soundtrack():
    """Original, sparse electric-piano-style notes and sine pads; no samples."""
    rate = 48000
    audio = np.zeros((round(DURATION*rate),2),dtype=np.float64)
    chords = [[53,60,64,69],[50,57,60,65],[46,53,57,62],[48,55,62,67]]
    def note(midi,start,length,gain,pan,pad=False):
        offset = round(start*rate)
        size = min(round(length*rate),len(audio)-offset)
        if size<=0: return
        time = np.arange(size)/rate
        freq = 440*2**((midi-69)/12)
        if pad:
            env = np.minimum(1,time/0.7)*np.minimum(1,np.maximum(0,(length-time)/1.3))
            wave_data = (np.sin(2*np.pi*freq*time)+0.15*np.sin(2*np.pi*(freq*1.003)*time))*env*gain
        else:
            env = (1-np.exp(-time*100))*np.exp(-time/1.55)*np.minimum(1,np.maximum(0,(length-time)/0.2))
            wave_data = (np.sin(2*np.pi*freq*time)+0.23*np.sin(2*np.pi*freq*2*time)*np.exp(-time*2)+0.07*np.sin(2*np.pi*freq*3*time))*env*gain
        audio[offset:offset+size,0] += wave_data*math.cos(pan*np.pi/2)
        audio[offset:offset+size,1] += wave_data*math.sin(pan*np.pi/2)
    for bar in range(7):
        chord=chords[bar%4]
        start=bar*5.65+0.25
        for midi in chord[:3]: note(midi-12,start,6.4,0.016,0.5,True)
        for k,j in enumerate([0,2,1,3,2,1,3,2]):
            note(chord[j]+12,start+k*0.70,3.5,0.092 if k%4==0 else 0.07,0.32+0.1*(k%4))
    time=np.arange(len(audio))/rate
    fade=np.minimum(1,time/1.4)*np.minimum(1,np.maximum(0,(DURATION-time)/3.0))
    audio*=fade[:,None]
    peak=float(np.max(np.abs(audio)))
    if peak>0: audio*=0.54/peak
    wav_path=WORK/'original-score.wav'
    with wave.open(str(wav_path),'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(rate)
        f.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
    peak_db = 20*math.log10(float(np.max(np.abs(audio))))
    rms_db = 20*math.log10(float(np.sqrt(np.mean(audio**2))))
    return wav_path, {'peak_dbfs': round(peak_db, 2), 'rms_dbfs': round(rms_db, 2)}

def encoder():
    found=os.environ.get('FFMPEG_BINARY') or shutil.which('ffmpeg')
    if found: return found
    sys.path.insert(0,str(ROOT/'.build/media-python'))
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def preview():
    timestamps=[2,8,15,21,28,34,39.6]
    contact=Image.new('RGB',(1440,3*290),CREAM)
    for i,t in enumerate(timestamps):
        image=frame(t).resize((480,270),Image.Resampling.LANCZOS)
        contact.paste(image,((i%3)*480,(i//3)*290))
        text(contact,((i%3)*480+8,(i//3)*290+271),f'{t:.1f}s',13)
    contact.save(WORK/'storyboard.jpg',quality=92)
    cover=frame_scene(0,2.5)
    cover.save(IMAGES/'promo-cover.jpg',quality=93)
    print('Preview and cover generated.',flush=True)

def render():
    preview()
    wav_path,levels=soundtrack()
    output=WORK/'moye-intro-original.mp4'
    command=[encoder(),'-y','-hide_banner','-loglevel','warning','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(wav_path),'-map','0:v','-map','1:a','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t',str(DURATION),'-movflags','+faststart','-metadata','title=Moye — Leave room for words','-metadata','comment=Actual Moye 1.1 UI captures; original synthesized music; Apache-2.0 project.',str(output)]
    with open(WORK/'ffmpeg.log','w',encoding='utf-8') as log:
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=log)
        try:
            for n in range(FPS*DURATION):
                process.stdin.write(frame(n/FPS).tobytes())
                if n%(FPS*3)==0: print(f'Rendered {n/FPS:.0f}/{DURATION} seconds',flush=True)
        finally: process.stdin.close()
        if process.wait()!=0: raise RuntimeError('FFmpeg failed; see .build/media/ffmpeg.log')
    manifest={'width':W,'height':H,'fps':FPS,'duration_seconds':DURATION,'codec':'H.264 / AAC','file':output.name,'bytes':output.stat().st_size,'soundtrack':'Original additive synthesis; no samples or external recording.','audio_levels':levels}
    (WORK/'original-video-info.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False),flush=True)

if __name__=='__main__':
    args=argparse.ArgumentParser()
    args.add_argument('--preview',action='store_true')
    if args.parse_args().preview: preview()
    else: render()
