import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'

/**
 * クリックでも開く部品(リンクの行・カンバンのカード)を、つまんで動かせるようにするときのセンサー。
 *
 * dnd-kit の既定は「200ms 押し続けたら、動かさなくてもドラッグを始める」。ドラッグが始まるとクリックは捨てられるので、
 * ゆっくり押しただけの行が開かない(連打すると開く)。マウスとペンは 5px 動いたときだけドラッグにする。
 * 指はスクロールと見分けるため、既定どおり長押し(250ms)で始める。
 */
export const clickableSensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor,
]
