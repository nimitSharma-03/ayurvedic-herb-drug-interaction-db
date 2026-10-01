"""Unit tests for medicine name normalization and pair keying (no database)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hdi.normalize import medicine_id, normalize_name, pair_key, slugify


class NormalizeNameTest(unittest.TestCase):
    def test_case_and_whitespace_are_folded(self):
        for raw in ("Paracetamol", "paracetamol", "PARACETAMOL", "  Paracetamol  "):
            self.assertEqual(normalize_name(raw), "paracetamol")

    def test_punctuation_becomes_a_single_space(self):
        self.assertEqual(
            normalize_name("Trigonella foenum-graecum"), "trigonella foenum graecum"
        )
        self.assertEqual(normalize_name("Withania   somnifera"), "withania somnifera")

    def test_accents_are_stripped(self):
        self.assertEqual(normalize_name("Échinacée"), "echinacee")

    def test_blank_and_none_normalize_to_empty(self):
        for raw in (None, "", "   ", "!!!", "---"):
            self.assertEqual(normalize_name(raw), "")

    def test_distinct_substances_do_not_collapse(self):
        """Normalization must never merge names that merely look alike.

        These are different reference rows, and conflating them would attribute
        one plant's interaction evidence to another.
        """
        self.assertNotEqual(normalize_name("Amla"), normalize_name("Bhumi Amla"))
        self.assertNotEqual(normalize_name("Black pepper"), normalize_name("False Black Pepper"))
        self.assertNotEqual(normalize_name("Guggul"), normalize_name("Salai Guggul"))


class IdentifierTest(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(slugify("Aloe vera"), "aloe-vera")
        self.assertEqual(slugify("Bhumi Amla"), "bhumi-amla")

    def test_medicine_id_is_stable_and_typed(self):
        self.assertEqual(medicine_id("herb", "Ashwagandha"), "herb-ashwagandha")
        self.assertEqual(medicine_id("drug", "Warfarin"), "drug-warfarin")
        self.assertEqual(medicine_id("herb", "Aloe vera"), "herb-aloe-vera")

    def test_pair_key_is_order_independent(self):
        forward = pair_key("herb-garlic", "drug-warfarin")
        reverse = pair_key("drug-warfarin", "herb-garlic")
        self.assertEqual(forward, reverse)

    def test_pair_key_distinguishes_different_pairs(self):
        self.assertNotEqual(
            pair_key("herb-garlic", "drug-warfarin"),
            pair_key("herb-garlic", "drug-aspirin"),
        )


if __name__ == "__main__":
    unittest.main()
