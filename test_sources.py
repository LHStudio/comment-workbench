import tempfile
import unittest

from server import Library


class SourceContract(unittest.TestCase):
    def test_article_and_answer(self):
        with tempfile.TemporaryDirectory() as td:
            lib = Library(td)
            for path in ("https://zhuanlan.zhihu.com/p/123",
                         "https://www.zhihu.com/question/12/answer/34"):
                row = dict(url=path, title="测试标题", key="1", text="样本")
                self.assertEqual(lib.add([row])["added"], 1)
                self.assertEqual(lib.add([row])["duplicate"], 1)
            with self.assertRaises(ValueError):
                lib.add([dict(row, url="https://www.zhihu.com.example.org/p/123")])
