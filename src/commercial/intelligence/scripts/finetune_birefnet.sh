#!/usr/bin/env bash
# Clone BiRefNet and launch portrait OR transparent fine-tune (Linux + GPU).
# Windows: run in WSL2 or a cloud GPU box with the same commands.
set -euo pipefail

TASK="${1:-portrait}"   # portrait | transparent
EPOCHS_EXTRA="${2:-50}"
DATA_ROOT="${DATA_ROOT:-$(pwd)/datasets/dis}"
CODES_DIR="${CODES_DIR:-$(pwd)/_vendor/BiRefNet}"

if [[ ! -d "$CODES_DIR" ]]; then
  git clone --depth 1 https://github.com/ZhengPeng7/BiRefNet.git "$CODES_DIR"
fi

cd "$CODES_DIR"

case "$TASK" in
  portrait)
    RESUME_WEIGHT="${RESUME_WEIGHT:-BiRefNet-portrait-epoch_150.pth}"
    TRAIN_SET="Portrait/TR-PORTRAIT"
    ;;
  transparent)
    RESUME_WEIGHT="${RESUME_WEIGHT:-BiRefNet_HR-matting-epoch_135.pth}"
    TRAIN_SET="Transparent/TR-GLASS"
    ;;
  *)
    echo "unknown task: $TASK (use portrait|transparent)" >&2
    exit 1
    ;;
esac

echo "Task=$TASK data=$DATA_ROOT/$TRAIN_SET resume=$RESUME_WEIGHT"
echo "Prepare data first:"
echo "  python scripts/prepare_birefnet_dataset.py --images private-eval/matting/golden --out $DATA_ROOT/${TRAIN_SET%%/*}/$(basename $TRAIN_SET) --scene $TASK --pseudo"
echo "Then edit config.py: sys_home_dir, training_set, testsets, lambdas_pix_last"
echo "Official guide: https://github.com/ZhengPeng7/BiRefNet#pen-fine-tuning-on-custom-data"
echo "Video: https://youtu.be/FwGT_0V9E-k"

# User sets START_EPOCH from checkpoint filename (e.g. 150 + 50 = 200)
START_EPOCH="${START_EPOCH:-200}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
python train.py --resume "$RESUME_WEIGHT" --epochs "$START_EPOCH" || true
echo "After training: export ONNX, copy to U2NET_HOME, set ILP_MATTING_${TASK^^}_ONNX"
