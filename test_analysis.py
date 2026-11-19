import unittest
from engine import attitude, model_group, tokens


class Semantics(unittest.TestCase):
    def test_attitude(self):
        for text, label in [
            ('豆包看报告挺好用', '正向'), ('我不信任它的诊断', '负向'),
            ('很方便，但也会误诊', '混合'), ('这个真的靠谱吗？', '待判定'),
            ('我身体很难受，头痛三天了', '待判定'), ('医生很专业', '待判定'),
            ('阿福一点也不靠谱', '负向'), ('[赞][赞]', '待判定'),
            ('豆包没有帮助', '负向'), ('医生说我恢复得很好', '待判定'),
            ('这个我还没用过', '待判定'), ('大半夜去哪里都不方便', '待判定'),
            ('这个健康助手让人安心', '正向')
        ]:
            with self.subTest(text=text):
                self.assertEqual(attitude(text)[0], label)

    def test_groups(self):
        self.assertEqual(model_group('我用豆包', '阿福体验', '')[0], '通用')
        self.assertEqual(model_group('都用过', '豆包和小荷AI医生', '')[0], '两类')
        self.assertEqual(model_group('都用过', '看病', '')[0], '未明确')

    def test_terms(self):
        self.assertEqual(tokens('不靠谱，不靠谱。@网友 [赞] 13800000000'), {'不靠谱'})
