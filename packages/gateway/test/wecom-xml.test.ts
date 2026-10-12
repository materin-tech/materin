import { describe, test, expect } from 'bun:test'
import { wecomXmlToInbound } from '../src/adapters/wecom'

describe('wecomXmlToInbound', () => {
  test('parses a realistic group inner XML', () => {
    const xml =
      '<xml><ToUserName><![CDATA[toUser]]></ToUserName>' +
      '<FromUserName><![CDATA[zhangsan]]></FromUserName>' +
      '<CreateTime>1409659813</CreateTime>' +
      '<MsgType><![CDATA[text]]></MsgType>' +
      '<Content><![CDATA[帮我看看构建日志]]></Content>' +
      '<ChatId><![CDATA[wrOdQg]]></ChatId>' +
      '</xml>'
    const parsed = wecomXmlToInbound(xml)
    expect(parsed).not.toBeNull()
    expect(parsed!.chatId).toBe('wrOdQg')
    expect(parsed!.userId).toBe('zhangsan')
    expect(parsed!.text).toBe('帮我看看构建日志')
    expect(parsed!.msgType).toBe('text')
  })

  test('single chat without ChatId falls back to FromUserName', () => {
    const xml =
      '<xml><FromUserName><![CDATA[zhangsan]]></FromUserName>' +
      '<MsgType><![CDATA[text]]></MsgType>' +
      '<Content><![CDATA[hi]]></Content>' +
      '</xml>'
    const parsed = wecomXmlToInbound(xml)
    expect(parsed!.chatId).toBe('zhangsan')
  })

  test('image message extracts MediaId, no text', () => {
    const xml =
      '<xml><FromUserName><![CDATA[zhangsan]]></FromUserName>' +
      '<MsgType><![CDATA[image]]></MsgType>' +
      '<PicUrl><![CDATA[https://example.com/x.jpg]]></PicUrl>' +
      '<MediaId><![CDATA[media_id_1]]></MediaId>' +
      '</xml>'
    const parsed = wecomXmlToInbound(xml)
    expect(parsed!.msgType).toBe('image')
    expect(parsed!.mediaId).toBe('media_id_1')
    expect(parsed!.text).toBeUndefined()
  })

  test('null when FromUserName missing', () => {
    expect(wecomXmlToInbound('<xml><MsgType><![CDATA[text]]></MsgType></xml>')).toBeNull()
  })
})
